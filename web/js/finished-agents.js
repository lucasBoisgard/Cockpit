// Agents the master has stopped have finished their work: the board and the orchestration tree hide them
// unless the user asks to see them. An agent that died on its own (lost after its last stop) has not finished and stays visible,
// and so does a stopped parent while one of its sub-agents is not hidden.
// Decisions without DOM, also required by the tests.
const finishedUi = { show: typeof localGet === 'function' && localGet('showFinished') === '1' };

const isFinishedAgent = (a) => a.status === 'stopped' && !!a.stoppedAt && !(a.lostAt > a.stoppedAt);

function hiddenAgentIds(agents) {
  const kids = new Map();
  for (const a of agents) kids.set(a.parentId, [...(kids.get(a.parentId) || []), a]);
  const memo = new Map();
  const hidden = (a) => {
    if (!memo.has(a.id)) {
      memo.set(a.id, false);
      memo.set(a.id, isFinishedAgent(a) && (kids.get(a.id) || []).every(hidden));
    }
    return memo.get(a.id);
  };
  return new Set(agents.filter(hidden).map((a) => a.id));
}

// A worktree is only hidden when every agent working in it is hidden; the master's own worktree never is.
function finishedScope(orchestrations, ended) {
  const sessions = new Set();
  const worktrees = new Set();
  let count = 0;
  for (const orch of [...Object.values(orchestrations || {}), ...Object.values(ended || {})]) {
    const hidden = hiddenAgentIds(orch.agents);
    const byWorktree = new Map();
    for (const a of orch.agents) {
      byWorktree.set(a.worktree, [...(byWorktree.get(a.worktree) || []), a]);
      if (!hidden.has(a.id)) continue;
      count++;
      if (a.sessionId) sessions.add(a.sessionId);
    }
    for (const [name, agents] of byWorktree) if (name !== orch.worktree && agents.every((a) => hidden.has(a.id))) worktrees.add(name);
  }
  return { sessions, worktrees, count };
}

// Hidden agents per top-level agent (the one shown under a phase), sub-agents included.
function hiddenCountByRoot(agents, hidden) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const counts = new Map();
  for (const a of agents) {
    if (!hidden.has(a.id)) continue;
    let root = a;
    while (root.parentId && byId.has(root.parentId)) root = byId.get(root.parentId);
    counts.set(root.id, (counts.get(root.id) || 0) + 1);
  }
  return counts;
}

// A worktree with no session, files (staged or not), unpushed commits or a branch the master has not merged
// (`unmerged`, set by the snapshot, is false only once the branch is an ancestor of the master's HEAD) still holds work.
function isFinishedWorktree(wt, scope, selectedPath) {
  return wt.path !== selectedPath && scope.worktrees.has(wt.name) && wt.sessions.length > 0 && !wt.files.length && !wt.staged && !(wt.ahead > 0) && wt.unmerged === false
    && wt.sessions.every((s) => scope.sessions.has(s.sessionId));
}

let finishedCache = { source: null, ended: null, scope: null };

function finishedNow() {
  const source = state?.orchestrations;
  const ended = state?.endedOrchestrations;
  if (finishedCache.source !== source || finishedCache.ended !== ended || !finishedCache.scope) finishedCache = { source, ended, scope: finishedScope(source, ended) };
  return finishedCache.scope;
}

const shownSessions = (wt) => (finishedUi.show ? wt.sessions : wt.sessions.filter((s) => !finishedNow().sessions.has(s.sessionId)));

const shownWorktrees = () => (finishedUi.show ? state.worktrees : state.worktrees.filter((w) => !isFinishedWorktree(w, finishedNow(), selected)));

const finishedBoardCount = () => state.worktrees.filter((w) => isFinishedWorktree(w, finishedNow(), selected)).length;

const finishedSessionCount = (wt) => wt.sessions.filter((s) => finishedNow().sessions.has(s.sessionId)).length;

const finishedLabel = (n, noun = 'agent') => (finishedUi.show ? 'Masquer les terminés' : `Afficher ${n} ${noun}${n > 1 ? 's' : ''} terminé${n > 1 ? 's' : ''}`);
const finishedWorktreeLabel = (n) => finishedLabel(n, 'worktree d’agent');

function setShowFinished(value) {
  finishedUi.show = value;
  localSet('showFinished', value ? '1' : '0');
  chatBarSignature = null;
  renderBoard();
  renderPanel();
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-finished-toggle]')) setShowFinished(!finishedUi.show);
  });
}

if (typeof module !== 'undefined') module.exports = { isFinishedAgent, hiddenAgentIds, finishedScope, hiddenCountByRoot, isFinishedWorktree };
