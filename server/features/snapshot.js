const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { REPO, BASE_BRANCH, CONFIG, TICK_ENABLED, SHELL_SESSION } = require('../config');
const { run, ghAvailable } = require('../io/exec');
const { loadStore, readSessions } = require('../io/store');
const { effectiveStatus, turnStatus, sessionOverlap, primarySession, paneOf, ownerOf } = require('../core/sessions');
const { latestLimits } = require('../core/usage');
const { cachedSnapshot, storeSnapshot } = require('../cache');
const { listWorktrees, livePanes, describe, hasTranscript, externalRepos, repoOf, baseBranchOf } = require('./worktrees');
const { agentsRunning, forgetOld } = require('./agents');
const { appState } = require('./app');
const { readUsageSnapshots } = require('./usage');
const { cachedPr } = require('./pr');
const { eventsSeq } = require('./events');
const { loadQueues } = require('./queue');
const { pendingAsk } = require('./asks');
const { pendingScreens } = require('./codex-screens');
const { orchestrations, activeAgentsBySession } = require('./orchestration');

const SIZE_TTL_MS = 10 * 60 * 1000;
const sizeCache = new Map();

async function snapshot() {
  const cached = cachedSnapshot();
  if (cached) return cached;
  const [worktrees, panes, app] = await Promise.all([listWorktrees(), livePanes(), appState()]);
  const described = await Promise.all(worktrees.map(describe));
  const byPath = new Map(described.map((d) => [d.path, d]));
  const snapshots = readUsageSnapshots();
  const usageBySession = new Map(snapshots.map((u) => [u.sessionId, u]));
  const queues = loadQueues();
  const links = loadStore('worktree-links.json', {});
  const orch = await orchestrations(panes);
  const orchAgents = activeAgentsBySession(orch);
  for (const session of readSessions().map((s) => effectiveStatus(s, panes, Date.now()))) {
    const owner = fs.existsSync(session.cwd) && ownerOf(session.cwd, worktrees);
    if (!owner) continue;
    const live = !!paneOf(session, panes);
    if (!live && !hasTranscript(session)) continue;
    const usage = usageBySession.get(session.sessionId);
    byPath.get(owner.path).sessions.push({
      ...session,
      actions: session.actions || [],
      live,
      usage: usage ? { context: usage.context, costUsd: usage.costUsd, model: usage.model, modelId: usage.modelId, effort: usage.effort, at: usage.at } : null,
      queue: queues[session.sessionId] || [],
      ask: live && session.status === 'needs_input' ? pendingAsk(session.sessionId) : null,
      externalRepos: await externalRepos(session, owner.path),
      agentsRunning: agentsRunning({ ...session, live }) + (orchAgents.get(session.sessionId) || 0),
    });
  }
  // Codex sessions waiting on a prompt before their hooks run: shown as GPT sessions that need the user.
  for (const p of await pendingScreens()) {
    const owner = fs.existsSync(p.cwd) && ownerOf(p.cwd, worktrees);
    if (!owner) continue;
    const waiting = !!p.prompt;
    const starting = !waiting && Date.now() - p.at < 15000;
    const hooksOff = !waiting && !starting && p.answered;
    byPath.get(owner.path).sessions.push({
      sessionId: `codex-screen:${p.tmux}`, synthetic: true, provider: 'codex', cwd: p.cwd, live: true, tmuxPane: p.pane,
      status: starting ? 'working' : waiting || hooksOff ? 'needs_input' : 'idle', permission: false, question: null, ask: null,
      message: waiting ? `GPT : ${p.prompt.title || 'une décision t’attend'}` : starting ? 'GPT démarre' : hooksOff ? 'GPT : hooks du cockpit à valider (/hooks)' : 'GPT ouvert : en attente de ta demande',
      codexScreen: { tmux: p.tmux, prompt: p.prompt, starting, hooksOff, setup: !!p.setup, agent: p.agent || null },
      task: p.setup ? 'Autoriser GPT sur ce dépôt' : 'Session GPT', startedAt: p.at, updatedAt: p.at, statusSince: p.at,
      actions: [], queue: [], usage: null, agentsRunning: 0, externalRepos: [],
    });
  }
  forgetOld(Date.now());
  const byName = new Map(described.map((d) => [d.name, d]));
  for (const d of described) {
    d.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    d.pr = cachedPr(d.branch, d.repo);
    d.overlap = sessionOverlap(d.sessions.filter((s) => s.live));
    d.parent = links[d.name] || null;
  }
  for (const d of described) {
    d.children = Object.entries(links)
      .filter(([, link]) => d.sessions.some((s) => s.sessionId === link.parentSessionId))
      .map(([name]) => ({ name, status: byName.has(name) ? (primarySession(byName.get(name).sessions) ? turnStatus(primarySession(byName.get(name).sessions)) : 'none') : 'closed' }));
  }
  const shellLive = [...panes.values()].some((p) => p.session === SHELL_SESSION);
  const data = {
    generatedAt: Date.now(),
    repo: REPO,
    repoName: (await repoOf(REPO))?.name || path.basename(REPO),
    baseBranch: BASE_BRANCH,
    tick: TICK_ENABLED,
    worktrees: described,
    shell: { live: shellLive },
    app,
    limits: latestLimits(snapshots),
    archives: loadStore('worktree-archive.json', []),
    orchestrations: orch,
    lastEventId: eventsSeq(),
    pr: { enabled: ghAvailable, labels: CONFIG.pr?.labels || [], assignee: CONFIG.pr?.assignee || '' },
  };
  storeSnapshot(data);
  return data;
}

function dirSize(wtPath) {
  const cached = sizeCache.get(wtPath);
  if (cached && (cached.pending || Date.now() - cached.at < SIZE_TTL_MS)) return cached.kb ?? null;
  sizeCache.set(wtPath, { ...(cached || {}), pending: true });
  execFile('du', ['-sk', wtPath], { timeout: 120000 }, (error, stdout) => {
    sizeCache.set(wtPath, { at: Date.now(), kb: error ? cached?.kb ?? null : Number(String(stdout).split('\t')[0]) || null });
  });
  return cached?.kb ?? null;
}

async function cleanupList() {
  const snap = await snapshot();
  const bases = new Map();
  for (const repo of new Set(snap.worktrees.map((w) => w.repo))) {
    const base = await baseBranchOf(repo);
    await run('git', ['-C', repo, 'fetch', '-q', 'origin', base]);
    bases.set(repo, base);
  }
  return Promise.all(snap.worktrees.filter((w) => !w.mainCheckout).map(async (w) => {
    const merged = w.headSha ? (await run('git', ['-C', w.repo, 'merge-base', '--is-ancestor', w.headSha, `origin/${bases.get(w.repo)}`])).ok : false;
    let mtime = 0;
    try {
      mtime = fs.statSync(w.path).mtimeMs;
    } catch {}
    const lastActivity = Math.max(mtime, w.lastCommit?.at || 0, ...w.sessions.map((s) => s.updatedAt || 0));
    return { name: w.name, path: w.path, repoName: w.repoName, branch: w.branch, dirty: w.files.length, ahead: w.ahead, upstream: w.upstream, merged, pr: w.pr ? { number: w.pr.number, state: w.pr.state } : null, live: w.sessions.some((s) => s.live), locked: w.locked, lastActivity, sizeKb: dirSize(w.path) };
  }));
}

module.exports = { snapshot, cleanupList };
