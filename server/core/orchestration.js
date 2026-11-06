const providers = require('./providers');
const permissionMode = require('./permission-mode');

// Pure decisions of the agent orchestration: a master session plans phases and launches agents
// (real Claude sessions in tmux), the cockpit tracks them and wakes the master when one finishes.

const MODELS = providers.CLAUDE_MODELS;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const AGENT_MODES = ['default', 'acceptEdits', 'auto', 'plan'];
const AUTONOMY = {
  blocking: 'Only ask the user when you are truly blocked: a decision you cannot make from the goal, the code or the agents\' reports, or an action that cannot be undone (pushing, opening a pull request, touching shared data).',
  milestones: 'Ask the user to validate the plan before launching the first agents, then at the end of each phase before starting the next one. Between those points, decide alone.',
  decisions: 'Ask the user before every meaningful decision: the plan, each agent you launch (task, model, effort), and how to resolve each blocked agent.',
};
const DEFAULT_SETTINGS = { autonomy: 'blocking', maxAgents: 6, agentMode: 'acceptEdits', maxDepth: 2 };
const MAX_AGENTS_LIMIT = 20;
const MAX_DEPTH_LIMIT = 4;
const START_GRACE_MS = 2 * 60 * 1000;
const ACTIVE = ['starting', 'working', 'needs'];
const FINISHED = ['done', 'stopped'];
const EVENTS_MAX = 300;
const WAKE_EXCERPT_CHARS = 1500;

const isActive = (status) => ACTIVE.includes(status);

function normalizeSettings(input = {}, base = DEFAULT_SETTINGS) {
  const out = { ...DEFAULT_SETTINGS, ...base };
  if (input.autonomy !== undefined) {
    if (!AUTONOMY[input.autonomy]) return { error: `Autonomie inconnue : ${input.autonomy}.` };
    out.autonomy = input.autonomy;
  }
  if (input.maxAgents !== undefined) {
    const n = Number(input.maxAgents);
    if (!Number.isInteger(n) || n < 1 || n > MAX_AGENTS_LIMIT) return { error: `Nombre d'agents entre 1 et ${MAX_AGENTS_LIMIT}.` };
    out.maxAgents = n;
  }
  if (input.agentMode !== undefined) {
    if (!AGENT_MODES.includes(input.agentMode)) return { error: `Mode de permission refusé pour un agent : ${input.agentMode}.` };
    out.agentMode = input.agentMode;
  }
  if (input.maxDepth !== undefined) {
    const n = Math.round(Number(input.maxDepth));
    if (Number.isFinite(n)) out.maxDepth = Math.min(MAX_DEPTH_LIMIT, Math.max(1, n));
  }
  return { settings: out };
}

function validatePhases(phases) {
  if (!Array.isArray(phases) || !phases.length || phases.length > 12) return { error: 'Donne entre 1 et 12 phases.' };
  const clean = phases.map((p) => String(p || '').trim().slice(0, 40));
  if (clean.some((p) => !p)) return { error: 'Une phase n\'a pas de nom.' };
  return { phases: clean };
}

// `models`: the provider's model catalog when it is not fixed (Codex); Claude's list is known.
// `inheritMode`: an agent launched into the orchestration may only be stricter than its mode, and than its parent's.
// `parentMode`: the launching agent's effective mode (null when the master launches).
function validateLaunch(input = {}, orch, models, { inheritMode = false, parentMode = null } = {}) {
  const name = String(input.name || '').trim();
  if (!name || name.length > 80) return { error: 'Donne un nom court à l\'agent (80 caractères au plus).' };
  const brief = String(input.brief || '').trim();
  if (!brief) return { error: 'Le brief de l\'agent est vide.' };
  if (brief.length > 40000) return { error: 'Brief trop long (40 000 caractères au plus) : mets les détails dans un fichier et donne son chemin.' };
  const provider = input.provider ? String(input.provider) : 'claude';
  const parentStricter = inheritMode && parentMode && permissionMode.isStricter(parentMode, orch.settings.agentMode);
  const ceiling = parentStricter ? parentMode : orch.settings.agentMode;
  const settings = providers.validateSettings(provider, { model: input.model, effort: input.effort, mode: input.mode || ceiling }, provider === 'claude' ? MODELS : models);
  if (settings.error) return settings;
  const { model, effort, mode } = settings;
  if (input.mode && inheritMode) {
    const refused = permissionMode.overrideError(mode, ceiling);
    if (refused) return { error: parentStricter ? refused.replace("l'orchestration est en", "l'agent parent est en") : refused };
  }
  const skills = (Array.isArray(input.skills) ? input.skills : input.skill ? [input.skill] : []).map((s) => String(s).trim()).filter(Boolean);
  if (skills.some((s) => !/^[\w:.-]{1,80}$/.test(s))) return { error: 'Nom de skill invalide.' };
  let phase = input.phase === undefined || input.phase === null || input.phase === '' ? null : Number(input.phase);
  if (phase !== null && typeof input.phase === 'string' && !/^\d+$/.test(input.phase)) {
    const index = orch.phases.findIndex((p) => p.toLowerCase() === input.phase.toLowerCase());
    phase = index >= 0 ? index : NaN;
  }
  if (phase !== null && (!Number.isInteger(phase) || phase < 0 || phase >= Math.max(orch.phases.length, 1))) return { error: `Phase inconnue : ${input.phase}.` };
  return { agent: { name, brief, provider, model, effort, mode, skills, phase: phase ?? currentPhase(orch, {}), isolated: !!input.isolated } };
}

function nextAgentId(orch) {
  const used = new Set(orch.agents.map((a) => a.id));
  let n = orch.agents.length + 1;
  while (used.has(`w${n}`)) n++;
  return `w${n}`;
}

function depthOf(orch, agentId) {
  let depth = 0;
  let current = orch.agents.find((a) => a.id === agentId);
  while (current) {
    depth++;
    current = current.parentId ? orch.agents.find((a) => a.id === current.parentId) : null;
  }
  return depth;
}

// Status of one agent from its Claude session (null until the session's first hook fires).
function agentStatus(agent, session, { live, now }) {
  if (agent.stoppedAt && !(session && live && (session.updatedAt || 0) > agent.stoppedAt)) return 'stopped';
  if (!session) return live || now - agent.createdAt < START_GRACE_MS ? 'starting' : 'stopped';
  if (!live) return 'stopped';
  if (session.status === 'needs_input') return 'needs';
  if (session.status === 'working' && !session.stale) return 'working';
  if ((session.agentsRunning || 0) > 0) return 'working';
  if (session.status === 'idle' && !session.lastAssistant && now - agent.createdAt < START_GRACE_MS) return 'starting';
  return 'done';
}

const maxDepth = (settings) => settings?.maxDepth ?? DEFAULT_SETTINGS.maxDepth;

function canLaunch(orch, statuses, parentId) {
  if (orch.paused) return 'Le maître est en pause : aucun nouvel agent tant que l\'utilisateur ne le relance pas.';
  if (orch.endedAt) return 'Cette orchestration est terminée.';
  const active = orch.agents.filter((a) => isActive(statuses[a.id])).length;
  if (active >= orch.settings.maxAgents) return `Déjà ${active} agents actifs sur ${orch.settings.maxAgents} autorisés : attends qu'un agent finisse ou arrête-en un.`;
  if (parentId && depthOf(orch, parentId) >= maxDepth(orch.settings)) return `Profondeur maximale atteinte (${maxDepth(orch.settings)} niveaux d'agents).`;
  return null;
}

function currentPhase(orch, statuses) {
  const open = orch.agents.filter((a) => !FINISHED.includes(statuses[a.id] || 'done')).map((a) => a.phase);
  if (open.length) return Math.min(...open);
  if (orch.agents.length) return Math.max(...orch.agents.map((a) => a.phase));
  return 0;
}

// What the user sees for the master as a whole.
function masterState(orch, masterStatus, statuses) {
  const list = orch.agents.map((a) => statuses[a.id]);
  if (masterStatus === 'needs_input' || list.includes('needs')) return 'needs';
  if (orch.paused) return 'paused';
  if (masterStatus === 'working' || list.some((s) => s === 'working' || s === 'starting')) return 'working';
  if (masterStatus === 'done') return 'done';
  return 'idle';
}

function counts(orch, statuses) {
  const out = { total: orch.agents.length, starting: 0, working: 0, needs: 0, done: 0, stopped: 0 };
  for (const a of orch.agents) out[statuses[a.id]] = (out[statuses[a.id]] || 0) + 1;
  return out;
}

// What the board needs to hide the finished agents of an orchestration: no brief, events or reports.
function agentRefs(orch, statuses) {
  return {
    masterSessionId: orch.masterSessionId,
    worktree: orch.worktree,
    agents: orch.agents.map((a) => ({ id: a.id, status: statuses[a.id], parentId: a.parentId || null, sessionId: a.sessionId || null, worktree: a.worktree, stoppedAt: a.stoppedAt || null, lostAt: a.lostAt || null })),
  };
}

function pushEvent(orch, event, now) {
  orch.events = [...(orch.events || []), { at: now, ...event }].slice(-EVENTS_MAX);
}

function excerpt(text, max = WAKE_EXCERPT_CHARS) {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

const oneLine = (text, max) => excerpt(String(text || '').replace(/\s+/g, ' '), max);

function wakeText(agent, kind, report) {
  const head = kind === 'stopped' ? `[cockpit] L'agent ${agent.id} « ${agent.name} » s'est arrêté.` : `[cockpit] L'agent ${agent.id} « ${agent.name} » a fini son tour.`;
  const body = report ? `\nSon dernier message :\n${excerpt(report)}` : '';
  return `${head}${body}\n(rapport complet : orchestrate read ${agent.id})`;
}

function resumeText(pending) {
  return pending.length ? `[cockpit] L'utilisateur t'a relancé. Pendant la pause :\n\n${pending.join('\n\n')}` : '[cockpit] L\'utilisateur t\'a relancé : reprends l\'orchestration.';
}

// Who receives an agent's report: its parent agent, or the master (held while the master is paused).
function wakeTarget(orch, agent) {
  if (agent.parentId) {
    const parent = orch.agents.find((a) => a.id === agent.parentId);
    if (parent) return { sessionId: parent.sessionId, hold: false };
  }
  return { sessionId: orch.masterSessionId, hold: !!orch.paused };
}

function cliCommand(root) {
  return `node ${root}/bin/orchestrate.js`;
}

function masterSystemPrompt({ settings, root }) {
  return [
    'This session is a master orchestrator started from the Cockpit. You do not do the work yourself: you plan it, launch agents (separate Claude sessions) to do it, follow them, check and integrate their results, and report to the user.',
    `Before anything else, read the orchestrate skill at ${root}/skills/orchestrate/SKILL.md and follow it. Your command line tool is: ${cliCommand(root)}`,
    `How often to involve the user: ${AUTONOMY[settings.autonomy]}`,
    `At most ${settings.maxAgents} agents may be active at the same time; the cockpit refuses more.`,
    `The agent tree may go ${maxDepth(settings)} level${maxDepth(settings) > 1 ? 's' : ''} deep below you; the cockpit refuses a launch beyond that.`,
    'Choose each agent\'s provider, model and effort from the relevance matrix (orchestrate matrix), launch it with --kind, and rate its work once checked (orchestrate rate).',
    'After launching agents, end your turn: the cockpit writes to you when an agent finishes its turn. Never wait in a sleep or polling loop.',
    'Answer the user in French.',
  ].join('\n');
}

// 1 for an agent the master launched, +1 for each level of agent below it.
function agentDepth(orch, agent) {
  return (agent.parentId ? depthOf(orch, agent.parentId) : 0) + 1;
}

function canLaunchSubAgents(orch, agent) {
  return agent.provider !== 'codex' && agentDepth(orch, agent) < maxDepth(orch.settings);
}

function agentSystemPrompt({ agent, orch = { settings: DEFAULT_SETTINGS, agents: [] }, masterWorktree, isolated, branch, root }) {
  const parent = agent.parentId ? orch.agents.find((a) => a.id === agent.parentId) : null;
  const boss = parent ? `agent ${parent.id} ("${parent.name}"), who launched you` : 'the master';
  const autonomy = orch.settings?.autonomy || DEFAULT_SETTINGS.autonomy;
  return [
    `You are agent ${agent.id} ("${agent.name}") of a team orchestrated by a master session in the Cockpit (worktree ${masterWorktree}). ${parent ? `You were launched by ${boss}; ` : ''}The first message is your brief from ${parent ? 'it' : 'the master'}.`,
    `Work autonomously on that brief only. Never ask the user questions and never use AskUserQuestion: when you are blocked or need a decision, end your turn with a message that starts with "BLOQUÉ :" and states the question, the options you see and the one you recommend. ${parent ? `${boss[0].toUpperCase()}${boss.slice(1)}` : 'The master'} answers you.`,
    `How often the master involves the user in this orchestration: ${AUTONOMY[autonomy]} The cockpit tells you if it changes.`,
    `Your last message of each turn is read by ${parent ? `agent ${parent.id}` : 'the master'}: make it a short report (what you did, the files you changed, what is left or uncertain), in French.`,
    ...(agent.skills.length ? [`Load these skills with the Skill tool before you start: ${agent.skills.join(', ')}.`] : []),
    isolated
      ? `You work in your own worktree on branch ${branch}. Commit your work on that branch before your final report; the master merges it. Never push.`
      : 'Other agents work in the same worktree at the same time: only touch the files your brief needs, and never run git commit, checkout, reset, stash, rebase or push unless your brief says so.',
    agent.provider === 'codex'
      ? 'You cannot reach the cockpit from your sandbox: never try to launch sub-agents.'
      : canLaunchSubAgents(orch, agent)
        ? `If your brief explicitly allows it, you may launch sub-agents with ${cliCommand(root)} (see ${root}/skills/orchestrate/SKILL.md).`
        : 'You are at the maximum depth of the agent tree: you cannot launch sub-agents, the cockpit refuses it. Do the work yourself.',
  ].join('\n');
}

// How an agent hears about a new autonomy level: with the next message it receives, or in its rules on
// resume when it is stopped. Nothing is pasted into a running session: it could land in a permission
// dialog, and a message to a finished agent would start a turn.
function noticeRoute(status) {
  return status === 'stopped' ? 'resume' : 'next-message';
}

// What the cockpit tells a running agent when the autonomy level changes.
function autonomyNotice(autonomy) {
  return `[cockpit] Le niveau d'autonomie de l'orchestration a changé. How often the master involves the user is now: ${AUTONOMY[autonomy]}`;
}

// Finds which orchestration a session belongs to: as its master, or as one of its agents.
// Ended orchestrations are kept for a while as history but no longer own their sessions.
function findBySession(store, sessionId) {
  if (!sessionId) return null;
  if (store[sessionId] && !store[sessionId].endedAt) return { orch: store[sessionId], agent: null };
  for (const orch of Object.values(store)) {
    if (orch.endedAt) continue;
    const agent = orch.agents.find((a) => a.sessionId && a.sessionId === sessionId);
    if (agent) return { orch, agent };
  }
  return null;
}

module.exports = {
  agentDepth, canLaunchSubAgents, autonomyNotice, noticeRoute,
  MODELS, EFFORTS, AGENT_MODES, AUTONOMY, DEFAULT_SETTINGS, MAX_DEPTH_LIMIT, START_GRACE_MS,
  isActive, normalizeSettings, validatePhases, validateLaunch, nextAgentId, depthOf, maxDepth, agentStatus, canLaunch,
  currentPhase, masterState, counts, agentRefs, pushEvent, excerpt, oneLine, wakeText, wakeTarget, resumeText, cliCommand,
  masterSystemPrompt, agentSystemPrompt, findBySession,
};
