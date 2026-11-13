const { summarizeToolInput } = require('./transcript');

const ACTING_MS = 15000;
const PENDING_MAX_MS = 10 * 60 * 1000;
const STALE_MS = 30 * 60 * 1000;
const RECENT_MS = 5 * 60 * 1000;
const FINAL_TOOLS = new Set(['SubagentHandback', 'StructuredOutput']);

const emptyActivity = () => ({ pending: {}, action: null, ended: false, skills: [], prompt: null });

const NOT_PROMPT = /^\s*(<local-command-std(out|err)>|<task-notification>|\[Request interrupted)/;

function humanPrompt(entry) {
  if (entry.type !== 'user' || entry.isMeta || entry.isCompactSummary || (entry.isSidechain && entry.parentUuid)) return null;
  if (entry.origin && entry.origin.kind !== 'human') return null;
  const content = entry.message?.content;
  const text = typeof content === 'string' ? content : Array.isArray(content) && !content.some((b) => b.type === 'tool_result') ? content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
  return text && !NOT_PROMPT.test(text) ? text : null;
}

function addSkill(activity, name, at) {
  activity.skills = [...activity.skills.filter((s) => s.name !== name), { name, at }];
}

function applyEntry(activity, entry, builtins = new Set()) {
  const content = Array.isArray(entry.message?.content) ? entry.message.content : [];
  const at = Date.parse(entry.timestamp) || null;
  const prompt = humanPrompt(entry);
  if (prompt !== null) {
    activity.skills = [];
    activity.ended = false;
    const command = prompt.match(/<command-name>\/?([^<\s]+)<\/command-name>/)?.[1];
    if (command && !builtins.has(command)) addSkill(activity, command, at);
    const args = prompt.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1];
    activity.prompt = (command ? `/${command} ${args || ''}` : prompt).replace(/\s+/g, ' ').trim().slice(0, 300) || null;
  }
  if (entry.type === 'assistant') {
    const uses = content.filter((b) => b.type === 'tool_use');
    for (const use of uses) {
      activity.pending[use.id] = at;
      activity.action = { tool: use.name, detail: String(summarizeToolInput(use.input)).slice(0, 160) };
      if (use.name === 'Skill' && use.input?.skill) addSkill(activity, String(use.input.skill), at);
    }
    activity.ended = uses.some((u) => FINAL_TOOLS.has(u.name)) || (!uses.length && content.some((b) => b.type === 'text') && entry.message?.stop_reason === 'end_turn');
  }
  if (entry.type === 'user') for (const block of content) if (block.type === 'tool_result') delete activity.pending[block.tool_use_id];
  return activity;
}

function applyText(activity, text, builtins) {
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      applyEntry(activity, JSON.parse(line), builtins);
    } catch {}
  }
  return activity;
}

function agentActivity(text, builtins) {
  return applyText(emptyActivity(), text, builtins);
}

const emptyProgress = () => ({ started: new Map(), done: new Set() });

function applyJournal(progress, text) {
  for (const line of text.split('\n')) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'started' && event.agentId) progress.started.set(event.agentId, { label: event.label || null, phase: event.phase || null });
    if (event.type === 'result' && event.agentId) progress.done.add(event.agentId);
  }
  return progress;
}

const workflowProgress = (text) => applyJournal(emptyProgress(), text);

const pendingFor = (activity, now) => Object.values(activity.pending).some((at) => !at || now - at < PENDING_MAX_MS);

function skillNodes(activity, running) {
  return activity.skills.map((skill) => ({ id: `skill:${skill.name}`, kind: 'skill', label: skill.name, state: running ? 'running' : 'done', at: skill.at }));
}

const MAIN_STOPPED = new Set(['idle', 'done', 'ended']);

function agentNode(agent, workflows, mainStatus, now) {
  const run = agent.workflowId ? workflows.get(agent.workflowId) : null;
  const foreground = agent.meta.requestShape === 'foreground' && !agent.workflowId;
  const finished = agent.meta.finished === true || agent.activity.ended || !!run?.done.has(agent.id) || (foreground && MAIN_STOPPED.has(mainStatus));
  const age = now - agent.mtime;
  if (finished ? age > RECENT_MS : age > STALE_MS) return null;
  const started = run?.started.get(agent.id);
  return {
    id: agent.id,
    kind: 'agent',
    label: agent.meta.description || started?.label || agent.id,
    type: agent.meta.agentType || null,
    phase: agent.meta.workflowPhase || started?.phase || null,
    background: agent.meta.requestShape === 'background',
    state: finished ? 'done' : 'running',
    acting: !finished && (pendingFor(agent.activity, now) || age < ACTING_MS),
    action: finished ? null : agent.activity.action,
    at: agent.mtime,
    skills: skillNodes(agent.activity, !finished),
    children: [],
  };
}

function agentTree({ main, agents, workflows, now }) {
  const nodes = new Map();
  for (const agent of agents) {
    const node = agentNode(agent, workflows, main.status, now);
    if (node) nodes.set(agent.id, { node, agent });
  }
  const root = {
    id: 'main',
    kind: 'main',
    label: main.task || 'Session',
    state: main.status === 'working' ? 'running' : main.status === 'needs_input' ? 'waiting' : 'idle',
    acting: main.status === 'working',
    action: main.status === 'working' ? main.action : null,
    skills: main.activity ? skillNodes(main.activity, !MAIN_STOPPED.has(main.status)) : [],
    children: [],
  };
  const groups = new Map();
  for (const { node, agent } of [...nodes.values()].sort((a, b) => a.agent.started - b.agent.started)) {
    const parent = agent.meta.parentAgentId && nodes.get(agent.meta.parentAgentId);
    if (parent) parent.node.children.push(node);
    else if (agent.workflowId) {
      if (!groups.has(agent.workflowId)) {
        const group = { id: agent.workflowId, kind: 'workflow', label: `Workflow ${agent.workflowId.replace(/^wf_/, '')}`, skills: [], children: [] };
        groups.set(agent.workflowId, group);
        root.children.push(group);
      }
      groups.get(agent.workflowId).children.push(node);
    } else root.children.push(node);
  }
  for (const group of groups.values()) {
    const running = group.children.filter((c) => c.state === 'running');
    group.state = running.length ? 'running' : 'done';
    group.acting = running.some((c) => c.acting);
    group.phase = running[running.length - 1]?.phase || null;
  }
  return root;
}

const GRACE_MS = 45 * 1000;

function agentNodes(node) {
  return node.children.flatMap((child) => [...(child.kind === 'agent' ? [child] : []), ...agentNodes(child)]);
}

function countActive(tree, updatedAt, now) {
  return agentNodes(tree).filter((n) => n.state === 'running' || (n.background && n.state === 'done' && n.at > (updatedAt || 0) && now - n.at < GRACE_MS)).length;
}

function countRunning(node) {
  return node.children.reduce((n, child) => n + (child.kind === 'agent' && child.state === 'running' ? 1 : 0) + countRunning(child), 0);
}

const ORCH_STATE = { starting: 'running', working: 'running', needs: 'waiting', done: 'done', stopped: 'done' };

const orchState = (agent) => (agent.status === 'stopped' && agent.lostAt ? 'lost' : ORCH_STATE[agent.status] || 'done');

function orchestrationSkills(declared, used, running) {
  const usedNames = new Set(used.map((s) => s.name));
  const names = [...new Set([...declared, ...used.map((s) => s.name)])];
  return names.map((name) => ({ id: `skill:${name}`, kind: 'skill', label: name, state: running && usedNames.has(name) ? 'running' : 'done', declared: declared.includes(name), used: usedNames.has(name) }));
}

function descendsFrom(agents, id, ancestorId) {
  const byId = new Map(agents.map((a) => [a.id, a]));
  const seen = new Set();
  for (let current = byId.get(id); current && !seen.has(current.id); current = byId.get(current.parentId)) {
    if (current.id === ancestorId) return true;
    seen.add(current.id);
  }
  return false;
}

// Descendants of an agent (all agents for a master), whatever their order in the store.
function descendantsOf(agents, rootId) {
  if (!rootId) return agents;
  const below = new Set([rootId]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const a of agents) if (a.parentId && a.parentId !== a.id && below.has(a.parentId) && !below.has(a.id)) grew = !!below.add(a.id);
  }
  return agents.filter((a) => a.id !== rootId && below.has(a.id));
}

// Agents an orchestration launched as their own sessions, nested by parent, with the skills their brief gave them and the ones they loaded.
function orchestrationNodes({ agents, phases, live }) {
  const nodes = new Map();
  for (const agent of agents) {
    const info = live[agent.id] || {};
    const state = orchState(agent);
    const running = state === 'running';
    nodes.set(agent.id, {
      id: `orch:${agent.id}`,
      kind: 'agent',
      orchestrated: true,
      label: `${agent.id} · ${agent.name}`,
      type: [agent.provider === 'codex' ? 'GPT' : null, agent.model, agent.effort].filter(Boolean).join(' · ') || null,
      phase: phases?.[agent.phase] || null,
      state,
      acting: running && !!info.acting,
      action: running ? info.action || null : null,
      skills: orchestrationSkills(agent.skills || [], info.skills || [], running),
      children: [...(info.children || [])],
    });
  }
  const roots = [];
  for (const agent of agents) {
    const parent = agent.parentId && agent.parentId !== agent.id && !descendsFrom(agents, agent.parentId, agent.id) && nodes.get(agent.parentId);
    (parent ? parent.children : roots).push(nodes.get(agent.id));
  }
  return roots;
}

module.exports = { emptyActivity, applyText, agentActivity, emptyProgress, applyJournal, workflowProgress, agentTree, countRunning, countActive, orchestrationNodes, descendantsOf };
