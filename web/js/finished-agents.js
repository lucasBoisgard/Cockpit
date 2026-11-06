// Agents the master has stopped have finished their work: the board and the orchestration tree hide them
// unless the user asks to see them. A stopped parent stays visible while one of its sub-agents is not hidden.
// Decisions without DOM, also required by the tests.
const finishedUi = { show: typeof localGet === 'function' && localGet('showFinished') === '1' };

function hiddenAgentIds(agents) {
  const kids = new Map();
  for (const a of agents) kids.set(a.parentId, [...(kids.get(a.parentId) || []), a]);
  const memo = new Map();
  const hidden = (a) => {
    if (!memo.has(a.id)) {
      memo.set(a.id, false);
      memo.set(a.id, a.status === 'stopped' && (kids.get(a.id) || []).every(hidden));
    }
    return memo.get(a.id);
  };
  return new Set(agents.filter(hidden).map((a) => a.id));
}

// A worktree is only hidden when every agent working in it is hidden; the master's own worktree never is.
function finishedScope(orchestrations) {
  const sessions = new Set();
  const worktrees = new Set();
  let count = 0;
  for (const orch of Object.values(orchestrations || {})) {
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

function agentsInSubtree(agents, id) {
  const kids = agents.filter((a) => a.parentId === id);
  return kids.reduce((n, a) => n + agentsInSubtree(agents, a.id), kids.length);
}

let finishedCache = { source: null, scope: null };

function finishedNow() {
  const source = state?.orchestrations;
  if (finishedCache.source !== source || !finishedCache.scope) finishedCache = { source, scope: finishedScope(source) };
  return finishedCache.scope;
}

const shownSessions = (wt) => (finishedUi.show ? wt.sessions : wt.sessions.filter((s) => !finishedNow().sessions.has(s.sessionId)));

function isFinishedWorktree(wt) {
  const scope = finishedNow();
  return !finishedUi.show && wt.path !== selected && scope.worktrees.has(wt.name) && wt.sessions.every((s) => scope.sessions.has(s.sessionId));
}

const shownWorktrees = () => state.worktrees.filter((w) => !isFinishedWorktree(w));

function finishedBoardCount() {
  const scope = finishedNow();
  let n = 0;
  for (const w of state.worktrees) {
    const hidden = w.sessions.filter((s) => scope.sessions.has(s.sessionId)).length;
    n += scope.worktrees.has(w.name) && hidden === w.sessions.length ? Math.max(hidden, 1) : hidden;
  }
  return n;
}

const finishedLabel = (n) => (finishedUi.show ? 'Masquer les terminés' : `Afficher ${n} agent${n > 1 ? 's' : ''} terminé${n > 1 ? 's' : ''}`);

function setShowFinished(value) {
  finishedUi.show = value;
  localSet('showFinished', value ? '1' : '0');
  chatBarSignature = null;
  renderGrid();
  renderPanel();
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-finished-toggle]')) setShowFinished(!finishedUi.show);
  });
}

if (typeof module !== 'undefined') module.exports = { hiddenAgentIds, finishedScope, agentsInSubtree };
