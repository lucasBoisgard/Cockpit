const fs = require('node:fs');
const { REPO } = require('../config');
const { git } = require('../io/exec');
const { claudeLockAlive } = require('../io/proc');
const { sessionsIn } = require('../io/store');
const { paneOf, ownerOf } = require('../core/sessions');
const { mergeRefusal, runsOutsideCockpit, pickDelivery, handoffText } = require('../core/session-merge');
const { listWorktrees, worktreeName, isMainCheckout, livePanes, hasTranscript, baseBranchOf } = require('./worktrees');
const { deliver, enqueue } = require('./queue');
const { startSession, resumeIn, archiveWorktree, unarchiveWorktree } = require('./sessions');

const COMMITS_MAX = 30;

// Sessions of this worktree only: the main checkout's path is a prefix of every worktree under it.
const ownSessions = (wt, worktrees) => sessionsIn(wt.path).filter((s) => ownerOf(s.cwd, worktrees)?.path === wt.path);

function presence(sessions, wt, panes) {
  return {
    sessions: sessions.map((s) => ({ ...s, hasTranscript: hasTranscript(s) })),
    liveIds: new Set(sessions.filter((s) => paneOf(s, panes)).map((s) => s.sessionId)),
    outsideIds: new Set(sessions.filter((s) => panes.claudeStatus?.has(s.sessionId)).map((s) => s.sessionId)),
    lockAlive: !!wt.claudeLock && claudeLockAlive(wt.claudeLock),
  };
}

async function branchState(wt) {
  const upstream = ((await git(wt.path, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])) || '').trim() || null;
  const base = upstream ? null : await baseBranchOf(wt.repo || REPO);
  const ranges = upstream ? ['@{u}..HEAD'] : [`origin/${base}..HEAD`, `${base}..HEAD`];
  let log = null;
  for (const range of ranges) if (log === null) log = await git(wt.path, ['log', '--format=%h %s', '-n', String(COMMITS_MAX), range]);
  const head = ((await git(wt.path, ['rev-parse', '--short', 'HEAD'])) || '').trim() || null;
  return { upstream, base, head, commits: (log || '').split('\n').filter(Boolean) };
}

async function handTo(delivery, target, text) {
  if (delivery.kind === 'live') {
    const outcome = await deliver(delivery.sessionId, text, true);
    return ['sent', 'queued'].includes(outcome) ? { delivered: outcome } : { error: 'La session cible ne répond pas dans tmux.' };
  }
  if (delivery.kind === 'resume') {
    const resumed = await resumeIn(target.path, delivery.sessionId, delivery.provider);
    if (!resumed.ok) return { error: `La session cible n’a pas pu reprendre : ${resumed.stderr.trim()}` };
    enqueue(delivery.sessionId, text);
    return { delivered: 'resumed' };
  }
  const started = await startSession({ worktree: worktreeName(target.path), prompt: text });
  return started.error ? started : { delivered: 'started' };
}

// Everything that can refuse is checked first; the source is then archived (reversible) before the target
// is told, so the target never hears of a merge that did not happen. A failed handoff restores the source.
async function mergeWorktree({ source: sourcePath, target: targetPath }) {
  const worktrees = await listWorktrees();
  const source = worktrees.find((w) => w.path === sourcePath);
  const target = worktrees.find((w) => w.path === targetPath);
  const refusal = mergeRefusal(
    source && { ...source, mainCheckout: isMainCheckout(source) },
    target,
    !!source && !!target && (source.repo || REPO) === (target.repo || REPO),
  );
  if (refusal) return { error: refusal };
  if (((await git(source.path, ['status', '--porcelain'])) || '').trim()) return { error: 'Ce worktree a des changements non commités : commite-les avant de le fusionner.' };

  const panes = await livePanes();
  const sourceSessions = ownSessions(source, worktrees);
  if (runsOutsideCockpit(presence(sourceSessions, source, panes))) return { error: 'Une session Claude ouverte hors cockpit tient ce worktree : quitte-la (/exit) puis réessaie.' };
  const delivery = pickDelivery({ ...presence(ownSessions(target, worktrees), target, panes), cwdExists: (cwd) => fs.existsSync(cwd) });
  if (delivery.error) return delivery;

  const text = handoffText({
    source: worktreeName(source.path),
    target: worktreeName(target.path),
    branch: source.branch || null,
    ...(await branchState(source)),
    sessions: sourceSessions.filter(hasTranscript).sort((a, b) => b.updatedAt - a.updatedAt).map((s) => ({ task: s.task, lastAssistant: s.lastAssistant, transcriptPath: s.transcriptPath })),
  });
  const archived = await archiveWorktree({ path: source.path });
  if (archived.error) return { error: `Fusion annulée, ${worktreeName(source.path)} n’a pas pu être retiré : ${archived.error}` };
  const handed = await handTo(delivery, target, text);
  if (handed.error) {
    const restored = await unarchiveWorktree({ path: source.path, resume: true });
    return { error: `${handed.error} Fusion annulée : ${restored.error ? `restaure ${worktreeName(source.path)} depuis les archives (${restored.error}).` : `${worktreeName(source.path)} est restauré.`}` };
  }
  return { ok: true, ...handed };
}

module.exports = { mergeWorktree };
