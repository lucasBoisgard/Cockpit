const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { REPO, BASE_BRANCH, CONFIG, TICK_ENABLED, SHELL_SESSION } = require('../config');
const { run, ghAvailable } = require('../io/exec');
const { loadStore, readSessions, readCheckpoints } = require('../io/store');
const { withClaudeStatus, paneOf, ownerOf } = require('../core/sessions');
const { latestLimits } = require('../core/usage');
const { cachedSnapshot, storeSnapshot } = require('../cache');
const { listWorktrees, livePanes, describe, hasTranscript, externalRepos, repoOf } = require('./worktrees');
const { appState } = require('./app');
const { readUsageSnapshots } = require('./usage');
const { cachedPr } = require('./pr');
const { eventsSeq } = require('./events');
const { loadQueues } = require('./queue');

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
  for (const session of readSessions().map((s) => withClaudeStatus(s, panes))) {
    const owner = fs.existsSync(session.cwd) && ownerOf(session.cwd, worktrees);
    if (!owner) continue;
    const live = !!paneOf(session, panes);
    if (!live && !hasTranscript(session)) continue;
    const usage = usageBySession.get(session.sessionId);
    byPath.get(owner.path).sessions.push({
      ...session,
      actions: session.actions || [],
      live,
      usage: usage ? { context: usage.context, costUsd: usage.costUsd, at: usage.at } : null,
      checkpoints: readCheckpoints(session.sessionId),
      queue: queues[session.sessionId] || [],
      externalRepos: await externalRepos(session, owner.path),
    });
  }
  const byName = new Map(described.map((d) => [d.name, d]));
  for (const d of described) {
    d.sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    d.pr = cachedPr(d.branch);
    d.parent = links[d.name] || null;
  }
  for (const d of described) {
    d.children = Object.entries(links)
      .filter(([, link]) => d.sessions.some((s) => s.sessionId === link.parentSessionId))
      .map(([name]) => ({ name, status: byName.get(name)?.sessions[0]?.status || (byName.has(name) ? 'none' : 'closed') }));
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
  await run('git', ['-C', REPO, 'fetch', '-q', 'origin', BASE_BRANCH]);
  return Promise.all(snap.worktrees.filter((w) => w.path !== REPO).map(async (w) => {
    const merged = w.headSha ? (await run('git', ['-C', REPO, 'merge-base', '--is-ancestor', w.headSha, `origin/${BASE_BRANCH}`])).ok : false;
    let mtime = 0;
    try {
      mtime = fs.statSync(w.path).mtimeMs;
    } catch {}
    const lastActivity = Math.max(mtime, w.lastCommit?.at || 0, ...w.sessions.map((s) => s.updatedAt || 0));
    return { name: w.name, path: w.path, branch: w.branch, dirty: w.files.length, ahead: w.ahead, upstream: w.upstream, merged, pr: w.pr ? { number: w.pr.number, state: w.pr.state } : null, live: w.sessions.some((s) => s.live), locked: w.locked, lastActivity, sizeKb: dirSize(w.path) };
  }));
}

module.exports = { snapshot, cleanupList };
