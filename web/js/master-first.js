// The master is the default entry of an orchestration and agents stay behind it. Decisions without DOM, also required by the tests.
// `orchestrations`: the snapshot's active orchestrations by master session id; each has masterSessionId, worktree and agents.

function agentIndex(orchestrations) {
  const index = new Map();
  for (const orch of Object.values(orchestrations || {})) {
    for (const a of orch.agents || []) if (a.sessionId) index.set(a.sessionId, { masterSessionId: orch.masterSessionId, agentId: a.id, status: a.status });
  }
  return index;
}

const masterOfSession = (sessionId, orchestrations) => agentIndex(orchestrations).get(sessionId)?.masterSessionId || null;

function orchestrationOfSession(sessionId, orchestrations) {
  if (!sessionId) return null;
  if (orchestrations?.[sessionId]) return orchestrations[sessionId];
  return Object.values(orchestrations || {}).find((o) => (o.agents || []).some((a) => a.sessionId === sessionId)) || null;
}

function defaultSessionId(sessions, orchestrations, fallbackId) {
  const master = sessions.find((s) => orchestrations?.[s.sessionId]);
  return master ? master.sessionId : fallbackId || null;
}

// Picker content: the master and plain sessions are peers; agent sessions are grouped, hidden unless `open` or selected.
function sessionPicker(sessions, orchestrations, selectedId, open) {
  const index = agentIndex(orchestrations);
  const agents = sessions.filter((s) => index.has(s.sessionId));
  const peers = sessions.filter((s) => !index.has(s.sessionId));
  const masters = peers.filter((s) => orchestrations?.[s.sessionId]);
  const needs = agents.filter((s) => s.live && s.status === 'needs_input').length;
  const shownAgents = agents.filter((s) => open || s.sessionId === selectedId);
  return { peers: [...masters, ...peers.filter((s) => !masters.includes(s))], agents, shownAgents, hiddenCount: agents.length - shownAgents.length, needs, canFold: agents.length > 0 };
}

// What the composer targets: an agent session gets a warning and a way back to its master.
function composerTarget(sessionId, orchestrations) {
  const hit = agentIndex(orchestrations).get(sessionId);
  if (!hit) return null;
  return { agentId: hit.agentId, masterSessionId: hit.masterSessionId };
}

// Board and queue: agent worktrees hang under their master's worktree. An agent waiting on the user stays visible.
function groupWorktrees(worktrees, orchestrations, expanded = new Set()) {
  const owner = new Map();
  for (const orch of Object.values(orchestrations || {})) {
    const agentsByWorktree = new Map();
    for (const a of orch.agents || []) {
      if (a.worktree && a.worktree !== orch.worktree) agentsByWorktree.set(a.worktree, [...(agentsByWorktree.get(a.worktree) || []), a]);
    }
    const masterWt = worktrees.find((w) => w.name === orch.worktree || w.sessions.some((s) => s.sessionId === orch.masterSessionId));
    if (!masterWt) continue;
    for (const [name, agents] of agentsByWorktree) {
      const wt = worktrees.find((w) => w.name === name);
      if (wt && wt !== masterWt && !owner.has(wt.path)) owner.set(wt.path, { masterPath: masterWt.path, needs: agents.some((a) => a.status === 'needs') });
    }
  }
  const children = new Map();
  for (const wt of worktrees) {
    const o = owner.get(wt.path);
    if (o) children.set(o.masterPath, [...(children.get(o.masterPath) || []), { wt, needs: o.needs }]);
  }
  const top = worktrees.filter((w) => !owner.has(w.path));
  const nested = (masterPath) => children.get(masterPath) || [];
  const visibleChildren = (masterPath) => nested(masterPath).filter((c) => expanded.has(masterPath) || c.needs).map((c) => c.wt);
  const summary = (masterPath) => {
    const all = nested(masterPath);
    return { count: all.length, needs: all.filter((c) => c.needs).length, hidden: all.length - visibleChildren(masterPath).length };
  };
  return { top, visibleChildren, summary, isAgentWorktree: (path) => owner.has(path), masterPathOf: (path) => owner.get(path)?.masterPath || null };
}

if (typeof module !== 'undefined') module.exports = { agentIndex, masterOfSession, orchestrationOfSession, defaultSessionId, sessionPicker, composerTarget, groupWorktrees };
