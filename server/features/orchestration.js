const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ROOT, REPO, PORT } = require('../config');
const { run, git, tmux } = require('../io/exec');
const { loadStore, saveStore, readSession, readSessions, writeSessionOverride } = require('../io/store');
const { paneOf, validName, tmuxSessionName, turnStatus, effectiveStatus } = require('../core/sessions');
const core = require('../core/orchestration');
const { invalidateSnapshot } = require('../cache');
const { listWorktrees, worktreeName, livePanes } = require('./worktrees');
const { readChat } = require('./chat');
const { deliver, enqueueMerged, dropQueued } = require('./queue');
const { skillEntries } = require('./skills');
const { launchClaude, launchProcess } = require('./sessions');
const matrix = require('./matrix');
const { registerCodexLaunch } = require('./codex-screens');
const { cycleSessionMode, modeShownBy } = require('./agent-mode');
const matrixCore = require('../core/matrix');
const providerCore = require('../core/providers');
const modeCore = require('../core/permission-mode');
const { binOf, codexHookCommand, codexInfo, codexCatalog } = require('./providers');

const STORE = 'worktree-orchestration.json';
const ENDED_KEEP_MS = 7 * 24 * 3600 * 1000;

// A Codex agent gets its session id from Codex itself: it is matched through its tmux pane as soon as
// its hook writes the session state.
function attachCodexSessions(store) {
  const pending = Object.values(store).flatMap((orch) => (orch.endedAt ? [] : orch.agents.filter((a) => !a.sessionId && a.pane)));
  if (!pending.length) return false;
  const sessions = readSessions().filter((s) => s.provider === 'codex' && s.tmuxPane);
  let changed = false;
  for (const agent of pending) {
    const match = sessions.find((s) => s.tmuxPane === agent.pane && (s.startedAt || 0) >= agent.createdAt - 5000);
    if (match) {
      agent.sessionId = match.sessionId;
      changed = true;
    }
  }
  return changed;
}

function load() {
  const store = loadStore(STORE, {});
  const now = Date.now();
  for (const [id, orch] of Object.entries(store)) if (orch.endedAt && now - orch.endedAt > ENDED_KEEP_MS) delete store[id];
  return store;
}

// Called where agent states are read for display or decisions (snapshot, status, resume), not on every load.
function attachPending() {
  const store = loadStore(STORE, {});
  if (attachCodexSessions(store)) save(store);
}

function save(store) {
  saveStore(STORE, store);
  invalidateSnapshot();
}

// Synchronous read-modify-write of one orchestration: never spans an await, so no write is lost.
function mutate(masterId, change) {
  const store = load();
  const orch = store[masterId];
  if (!orch) return null;
  const out = change(orch);
  save(store);
  return out;
}

// Launches, stops and resumes run one at a time: agent ids and the active-agent limit stay exact.
let chain = Promise.resolve();
function locked(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

const allowList = () => [`Bash(${core.cliCommand(ROOT)}:*)`, `Read(${ROOT}/skills/**)`];
const launchEnv = (s) => [`COCKPIT_PORT=${PORT}`, `COCKPIT_LAUNCH=${JSON.stringify({ provider: s.provider || 'claude', model: s.model || null, effort: s.effort || null, mode: s.mode || null })}`];
const launch = (name, cwd, args, settings = {}) => launchClaude(name, cwd, args, launchEnv(settings));


// Every launch of an agent (first start or resume) carries its rules, its tools and its settings.
// --allowedTools takes several values: it is always followed by another flag, never by the prompt.
function agentArgs(orch, agent, { resume, prompt }) {
  if (agent.provider === 'codex') {
    const rules = core.agentSystemPrompt({ agent, orch, masterWorktree: orch.worktree, isolated: agent.isolated, branch: agent.branch, root: ROOT });
    // An isolated agent commits on its branch: its git metadata lives outside the worktree.
    return providerCore.launchArgs('codex', { resume, sessionId: agent.sessionId, hookCommand: codexHookCommand(), model: agent.model, effort: agent.effort, mode: agent.mode, rules: resume ? null : rules, prompt, addDirs: agent.isolated && agent.gitDir ? [agent.gitDir] : [] });
  }
  return providerCore.launchArgs('claude', {
    allow: allowList(), resume, sessionId: agent.sessionId, name: `${agent.id} · ${agent.name}`,
    rules: core.agentSystemPrompt({ agent, orch, masterWorktree: orch.worktree, isolated: agent.isolated, branch: agent.branch, root: ROOT }),
    model: agent.model, effort: agent.effort, mode: agent.mode, prompt,
  });
}

// Live view of every agent: its session (from the hook state files) and its status.
function liveStatuses(orch, panes) {
  const statuses = {};
  const sessions = {};
  const now = Date.now();
  for (const agent of orch.agents) {
    const raw = readSession(agent.sessionId);
    const session = raw ? effectiveStatus(raw, panes, now) : null;
    sessions[agent.id] = session;
    const live = session ? !!paneOf(session, panes) : !!(agent.pane && panes.has(agent.pane));
    statuses[agent.id] = core.agentStatus(agent, session, { live, now });
  }
  return { statuses, sessions };
}

function resolveCaller(store, callerId) {
  return core.findBySession(store, String(callerId || '')) || { error: 'Cette session n\'est ni un maître ni un agent actif du cockpit.' };
}

function agentOf(store, caller, id) {
  const found = resolveCaller(store, caller);
  if (found.error) return found;
  const agent = found.orch.agents.find((a) => a.id === String(id || ''));
  return agent ? { orch: found.orch, agent, by: found.agent?.id || 'maître' } : { error: `Agent inconnu : ${id}.` };
}

async function toplevel(cwd) {
  return ((await git(cwd, ['rev-parse', '--show-toplevel'])) || '').trim() || cwd;
}

function newOrchestration(sessionId, fields, settings, now) {
  return { masterSessionId: sessionId, phases: [], agents: [], events: [], paused: false, pendingWake: [], settings, createdAt: now, ...fields };
}

// Master: a normal Claude session with the orchestrator system prompt and the CLI allowed.
async function startMaster({ worktree, prompt, model, effort, mode, autonomy, maxAgents, agentMode, maxDepth }) {
  const name = String(worktree || '').trim();
  if (!validName(name)) return { error: 'Nom de worktree invalide (lettres, chiffres, . _ -).' };
  const goal = String(prompt || '').trim();
  if (!goal) return { error: 'Décris l\'objectif du maître.' };
  const normalized = core.normalizeSettings({ autonomy, maxAgents, agentMode, maxDepth });
  if (normalized.error) return normalized;
  const setting = core.validateLaunch({ name: 'maître', brief: goal, model, effort, mode: mode || 'default' }, { settings: normalized.settings, phases: [], agents: [] });
  if (setting.error) return setting;
  const existing = (await listWorktrees()).find((wt) => worktreeName(wt.path) === name);
  const sessionId = crypto.randomUUID();
  const args = providerCore.launchArgs('claude', {
    newWorktree: existing ? null : name, allow: allowList(), sessionId, name: `maître · ${name}`,
    rules: core.masterSystemPrompt({ settings: normalized.settings, root: ROOT }), ...setting.agent, prompt: goal,
  });
  const tmuxName = tmuxSessionName(name, Date.now());
  const result = await launch(tmuxName, existing ? existing.path : REPO, args, setting.agent);
  if (!result.ok) return { error: result.stderr.trim() };
  const store = load();
  const now = Date.now();
  store[sessionId] = newOrchestration(sessionId, { worktree: name, goal: goal.slice(0, 2000), model: setting.agent.model, effort: setting.agent.effort, tmux: tmuxName }, normalized.settings, now);
  core.pushEvent(store[sessionId], { type: 'start', text: 'Maître lancé' }, now);
  save(store);
  return { session: tmuxName, sessionId };
}

// Turns an existing session into a master: it gets the orchestrator instructions as a message.
async function promote({ sessionId, autonomy, maxAgents, agentMode, maxDepth }) {
  const session = readSession(String(sessionId || ''));
  if (!session) return { error: 'Session inconnue.' };
  const normalized = core.normalizeSettings({ autonomy, maxAgents, agentMode, maxDepth });
  if (normalized.error) return normalized;
  const store = load();
  if (core.findBySession(store, session.sessionId)) return { error: 'Cette session orchestre déjà, ou est un agent.' };
  const now = Date.now();
  store[session.sessionId] = newOrchestration(session.sessionId, { worktree: path.basename(session.cwd), goal: session.task || '' }, normalized.settings, now);
  core.pushEvent(store[session.sessionId], { type: 'start', text: 'Session passée en mode maître' }, now);
  save(store);
  const outcome = await deliver(session.sessionId, `[cockpit] Tu deviens le maître orchestrateur de cette tâche.\n${core.masterSystemPrompt({ settings: normalized.settings, root: ROOT })}\nL'outil orchestrate peut te demander une permission la première fois.`, true);
  return { ok: true, delivery: outcome };
}

async function setPlan({ caller, phases }) {
  const found = resolveCaller(load(), caller);
  if (found.error) return found;
  if (found.agent) return { error: 'Seul le maître définit les phases.' };
  const checked = core.validatePhases(phases);
  if (checked.error) return checked;
  mutate(found.orch.masterSessionId, (orch) => {
    orch.phases = checked.phases;
    core.pushEvent(orch, { type: 'plan', text: `Plan : ${checked.phases.join(' → ')}` }, Date.now());
  });
  return { ok: true, phases: checked.phases };
}

// An isolated agent works next to the master's worktree, on a branch made from its HEAD.
// The master's id is in the names so that a later master in the same worktree never collides.
async function isolatedWorktree(baseCwd, masterWorktree, tag) {
  const top = await toplevel(baseCwd);
  const common = ((await git(top, ['rev-parse', '--path-format=absolute', '--git-common-dir'])) || '').trim();
  const repo = path.basename(common) === '.git' ? path.dirname(common) : top;
  const base = ((await git(top, ['rev-parse', '--abbrev-ref', 'HEAD'])) || '').trim();
  const folder = `${masterWorktree}--${tag}`.replace(/[^\w.-]/g, '-');
  const branch = `${base && base !== 'HEAD' ? base : `orchestration/${masterWorktree}`}--${tag}`;
  const dir = top === repo ? path.join(path.dirname(repo), `${path.basename(repo)}-worktrees`, folder) : path.join(path.dirname(top), folder);
  if (fs.existsSync(dir)) return { error: `${dir} existe déjà.` };
  const added = await run('git', ['-C', top, 'worktree', 'add', '-b', branch, dir, 'HEAD']);
  return added.ok ? { cwd: dir, branch, worktree: folder, gitDir: common || null } : { error: added.stderr.trim() };
}

function launchFor(agent, name, cwd, args) {
  if (agent.provider !== 'codex') return launch(name, cwd, args, agent);
  registerCodexLaunch(name, cwd, { agent: agent.id });
  return launchProcess(name, cwd, binOf('codex'), args, launchEnv(agent));
}

async function paneOfTmux(name) {
  const out = await tmux(['display-message', '-p', '-t', name, '#{pane_id}']);
  return out.ok ? out.stdout.trim() : null;
}

function launchAgent({ caller, ...input }) {
  return locked(async () => {
    const found = resolveCaller(load(), caller);
    if (found.error) return found;
    const { orch } = found;
    const parentId = found.agent?.id || null;
    if (found.agent?.provider === 'codex') return { error: 'Un agent GPT (Codex) ne peut pas lancer de sous-agents : demande au maître de le faire.', refused: true };
    if (input.provider === 'codex') {
      const info = await codexInfo();
      if (!info.installed || !info.loggedIn) return { error: info.installed ? 'Codex n’est pas connecté : l’utilisateur doit lancer « codex login ». Lance cet agent avec Claude en attendant.' : 'Codex CLI n’est pas installé sur cette machine : lance cet agent avec Claude.' };
    }
    const checked = core.validateLaunch(input, orch, input.provider === 'codex' ? await codexCatalog() : undefined, { inheritMode: true, parentMode: found.agent?.mode || null });
    if (checked.error) return checked;
    const inheritedOverride = modeCore.strictest(checked.agent.mode, found.agent?.modeOverride);
    if (found.agent?.modeOverride || checked.agent.mode !== orch.settings.agentMode) checked.agent.modeOverride = inheritedOverride;
    const kind = input.kind ? String(input.kind) : null;
    if (kind && !matrix.categoryIds().includes(kind)) return { error: `Catégorie inconnue : ${kind} (${matrix.categoryIds().join(', ')}).` };
    checked.agent.kind = kind;
    const { statuses } = liveStatuses(orch, await livePanes());
    const refused = core.canLaunch(orch, statuses, parentId);
    if (refused) return { error: refused, refused: true };
    const parentCwd = found.agent ? found.agent.cwd : readSession(orch.masterSessionId)?.cwd;
    if (!parentCwd || !fs.existsSync(parentCwd)) return { error: 'Le worktree du maître est introuvable.' };
    const id = core.nextAgentId(orch);
    const agent = { id, ...checked.agent, parentId, sessionId: checked.agent.provider === 'codex' ? null : crypto.randomUUID(), createdAt: Date.now(), cwd: await toplevel(parentCwd), worktree: found.agent?.worktree || orch.worktree };
    if (agent.isolated) {
      const made = await isolatedWorktree(agent.cwd, orch.worktree, core.agentTag(orch, id));
      if (made.error) return made;
      Object.assign(agent, { cwd: made.cwd, worktree: made.worktree, branch: made.branch, gitDir: made.gitDir });
    }
    agent.tmux = tmuxSessionName(`${orch.worktree}-${id}`, Date.now());
    const result = await launchFor(agent, agent.tmux, agent.cwd, agentArgs(orch, agent, { resume: false, prompt: agent.brief }));
    if (!result.ok) return { error: result.stderr.trim() };
    if (agent.provider === 'codex') agent.pane = await paneOfTmux(agent.tmux);
    mutate(orch.masterSessionId, (o) => {
      o.agents.push(agent);
      core.pushEvent(o, { type: 'launch', agent: id, parent: parentId, text: `${parentId ? `${parentId} lance` : 'Lance'} ${id} « ${agent.name} » (${[agent.model || 'modèle par défaut', agent.effort, ...agent.skills].filter(Boolean).join(' · ')})` }, Date.now());
    });
    return { id, sessionId: agent.sessionId, cwd: agent.cwd, branch: agent.branch || null };
  });
}

async function killAgent(orch, agent, byText) {
  const pane = paneOf(readSession(agent.sessionId), await livePanes());
  if (pane) await tmux(['kill-pane', '-t', pane]);
  else if (agent.tmux) await tmux(['kill-session', '-t', agent.tmux]);
  writeSessionOverride(agent.sessionId, { status: 'ended', tmuxPane: null, updatedAt: Date.now() });
  mutate(orch.masterSessionId, (o) => {
    const target = o.agents.find((a) => a.id === agent.id);
    target.stoppedAt = Date.now();
    if (byText) core.pushEvent(o, { type: 'stopped', agent: agent.id, text: `${byText} ${agent.id}` }, Date.now());
  });
}

function stopAgent({ caller, id, by }) {
  return locked(async () => {
    const found = agentOf(load(), caller, id);
    if (found.error) return found;
    await killAgent(found.orch, found.agent, by === 'user' ? 'Tu as arrêté' : `${found.by} arrête`);
    return { ok: true };
  });
}

async function deliverToAgent(found, text, by) {
  const message = String(text || '').trim();
  if (!message) return { error: 'Message vide.' };
  const fromUser = by === 'user';
  const notice = found.agent.noticePending ? `${core.autonomyNotice(found.orch.settings.autonomy)}\n\n` : '';
  const outcome = await deliver(found.agent.sessionId, `${notice}${fromUser ? message : `[${found.by}] ${message}`}`, true);
  if (notice && ['sent', 'queued'].includes(outcome)) mutate(found.orch.masterSessionId, (o) => delete o.agents.find((a) => a.id === found.agent.id).noticePending);
  if (outcome === 'offline' || outcome === 'unknown') return { error: `${found.agent.id} ne tourne plus : relance-le avec resume.` };
  mutate(found.orch.masterSessionId, (o) => core.pushEvent(o, { type: 'message', agent: found.agent.id, from: fromUser ? 'user' : found.by, text: core.oneLine(message, 300) }, Date.now()));
  return { ok: true, delivery: outcome };
}

async function sendToAgent({ caller, id, text, by }) {
  const found = agentOf(load(), caller, id);
  return found.error ? found : deliverToAgent(found, text, by);
}

function resumeAgent({ caller, id, text, by }) {
  return locked(async () => {
    attachPending();
    const found = agentOf(load(), caller, id);
    if (found.error) return found;
    const { orch, agent } = found;
    const panes = await livePanes();
    const session = readSession(agent.sessionId);
    const message = String(text || '').trim();
    if (paneOf(session, panes) || (!session && agent.pane && panes.has(agent.pane))) {
      if (!session) return { error: `${agent.id} tourne encore mais le cockpit ne voit pas sa session : valide le hook avec /hooks dans son terminal.` };
      return message ? deliverToAgent(found, message, by) : { ok: true, running: true };
    }
    return restartAgent(orch, agent, message, `${by === 'user' ? 'Tu relances' : `${found.by} relance`} ${agent.id}`);
  });
}

// Starts a stopped agent again in its own conversation, with the settings stored on it.
async function restartRefusal(orch, agent) {
  if (!fs.existsSync(agent.cwd)) return { error: 'Le worktree de cet agent n\'existe plus.' };
  const { statuses } = liveStatuses(orch, await livePanes());
  const refused = core.launchQuotaRefusal(orch, { ...statuses, [agent.id]: 'stopped' });
  return refused ? { error: refused, refused: true } : null;
}

async function restartAgent(orch, agent, message, eventText) {
  const refusal = await restartRefusal(orch, agent);
  if (refusal) return refusal;
  const parent = agent.parentId ? orch.agents.find((a) => a.id === agent.parentId) : null;
  const allowed = modeCore.strictest(orch.settings.agentMode, parent?.mode);
  if (modeCore.isStricter(allowed, agent.mode)) {
    agent.mode = allowed;
    mutate(orch.masterSessionId, (o) => { const target = o.agents.find((a) => a.id === agent.id); if (target) target.mode = allowed; });
  }
  const session = readSession(agent.sessionId);
  const tmuxName = tmuxSessionName(`${orch.worktree}-${agent.id}`, Date.now());
  // Without a transcript the agent never really started: start it again from its brief.
  const prompt = session ? message : [agent.brief, message].filter(Boolean).join('\n\n');
  const result = await launchFor(agent, tmuxName, agent.cwd, agentArgs(orch, agent, { resume: !!session, prompt }));
  const pane = agent.provider === 'codex' && result.ok ? await paneOfTmux(tmuxName) : null;
  if (!result.ok) return { error: result.stderr.trim() };
  mutate(orch.masterSessionId, (o) => {
    const target = o.agents.find((a) => a.id === agent.id);
    target.tmux = tmuxName;
    if (pane) target.pane = pane;
    target.resumedAt = Date.now();
    delete target.stoppedAt;
    delete target.lostAt;
    delete target.modePending;
    delete target.noticePending;
    core.pushEvent(o, { type: 'launch', agent: agent.id, text: eventText }, Date.now());
  });
  return { ok: true };
}

function lastReport(sessionId) {
  const items = readChat(sessionId)?.items || [];
  const lastUser = items.map((i) => i.kind).lastIndexOf('user');
  const texts = items.slice(lastUser + 1).filter((i) => i.kind === 'assistant').map((i) => i.text);
  return texts.length ? texts.join('\n\n') : null;
}

function editedFiles(session) {
  const files = new Set();
  for (const action of session?.actions || []) {
    if (!action.detail) continue;
    if (['Edit', 'MultiEdit', 'Write', 'NotebookEdit'].includes(action.tool)) files.add(action.detail);
    else if (action.tool === 'apply_patch') for (const file of action.detail.split(', ')) files.add(file);
  }
  return [...files];
}

async function readAgent({ caller, id }) {
  const found = agentOf(load(), caller, id);
  if (found.error) return found;
  const { agent, orch } = found;
  const { statuses, sessions } = liveStatuses(orch, await livePanes());
  return { id: agent.id, name: agent.name, status: statuses[agent.id], report: lastReport(agent.sessionId), files: editedFiles(sessions[agent.id]), branch: agent.branch || null, cwd: agent.cwd };
}

function agentView(agent, status, session) {
  return {
    id: agent.id, name: agent.name, status, provider: agent.provider || 'claude', kind: agent.kind || null, rating: agent.rating || null, model: agent.model, effort: agent.effort, mode: agent.mode, modePending: !!agent.modePending, skills: agent.skills, phase: agent.phase,
    parentId: agent.parentId, sessionId: agent.sessionId, worktree: agent.worktree, isolated: agent.isolated, branch: agent.branch || null,
    createdAt: agent.createdAt, stoppedAt: agent.stoppedAt || null, lost: !!agent.lostAt, lostAt: agent.lostAt || null, brief: core.excerpt(agent.brief, 4000),
    unattached: agent.provider === 'codex' && !agent.sessionId && status === 'starting' && Date.now() - agent.createdAt > 20000,
    action: session?.actions?.[0] ? `${session.actions[0].tool} · ${session.actions[0].detail || ''}` : null,
    lastAssistant: session?.lastAssistant || null, message: session?.status === 'needs_input' ? session.message || null : null,
    files: editedFiles(session),
  };
}

function view(orch, panes, store = load()) {
  const { statuses, sessions } = liveStatuses(orch, panes);
  const rawMaster = readSession(orch.masterSessionId);
  const master = rawMaster ? effectiveStatus(rawMaster, panes, Date.now()) : null;
  const masterStatus = master ? (paneOf(master, panes) ? turnStatus(master) : 'ended') : 'starting';
  return {
    masterSessionId: orch.masterSessionId,
    job: core.jobNumber(orch),
    history: core.jobHistory(store, orch.masterSessionId),
    worktree: orch.worktree,
    goal: orch.goal,
    settings: { ...orch.settings, maxDepth: core.maxDepth(orch.settings) },
    masterModePending: orch.masterModePending || null,
    paused: !!orch.paused,
    phases: orch.phases,
    phase: core.currentPhase(orch, statuses),
    state: core.masterState(orch, masterStatus, statuses),
    masterStatus,
    counts: core.counts(orch, statuses),
    agents: orch.agents.map((a) => agentView(a, statuses[a.id], sessions[a.id])),
    events: orch.events.slice(-60),
    pendingWake: orch.pendingWake?.length || 0,
    createdAt: orch.createdAt,
  };
}

async function status({ caller }) {
  attachPending();
  const found = resolveCaller(load(), caller);
  return found.error ? found : view(found.orch, await livePanes());
}

// Active orchestrations as full views, and ended ones (kept for a while) as slim refs, from one read of the store.
async function orchestrationViews(givenPanes) {
  const panes = givenPanes || (await livePanes());
  attachPending();
  const active = {};
  const ended = {};
  const store = load();
  for (const [key, orch] of Object.entries(store)) {
    if (!orch.endedAt) active[orch.masterSessionId] = view(orch, panes, store);
    else ended[key] = core.agentRefs(orch, liveStatuses(orch, panes).statuses);
  }
  return { active, ended };
}

const orchestrations = async (givenPanes) => (await orchestrationViews(givenPanes)).active;

async function setPaused({ master, paused }) {
  const pending = mutate(String(master || ''), (orch) => {
    orch.paused = !!paused;
    core.pushEvent(orch, { type: paused ? 'pause' : 'resume', text: paused ? 'Tu as mis le maître en pause' : 'Tu as relancé le maître' }, Date.now());
    const held = orch.pendingWake || [];
    if (!paused) orch.pendingWake = [];
    return held;
  });
  if (!pending) return { error: 'Maître inconnu.' };
  if (!paused) await deliver(master, core.resumeText(pending), true);
  return { ok: true };
}

const modeMessage = (mode) => `[cockpit] Le mode de permission est passé à ${mode}, reprends là où tu en étais.`;
const modeName = (mode) => modeCore.MODE_LABELS[mode] || mode;

const note = (masterId, text, agent) => mutate(masterId, (o) => core.pushEvent(o, { type: 'settings', ...(agent ? { agent } : {}), text }, Date.now()));

// After a relaunch with --permission-mode, the screen says which mode Claude Code really started in (a mode
// the model or the account does not offer is not an error of the command line).
const modeChecks = new Set();
function verifyRelaunchedMode(masterId, agentId, tmuxName, target) {
  const check = modeShownBy(tmuxName).then((shown) => {
    if (!shown || shown === target) return;
    mutate(masterId, (o) => {
      core.pushEvent(o, { type: 'settings', agent: agentId, text: `${agentId} relancé, mais son écran affiche ${modeName(shown)} au lieu de ${modeName(target)} : Maj+Tab dans son terminal` }, Date.now());
    });
  }).catch((error) => console.error('mode check failed', error)).finally(() => modeChecks.delete(check));
  modeChecks.add(check);
}

// A relaunch that cannot happen is refused before anything is killed; one that fails after the kill is
// reported like a lost agent, so nobody waits for it.
async function relaunchAgent(masterId, agentId, message) {
  const orch = load()[masterId];
  const agent = orch?.agents.find((a) => a.id === agentId);
  if (!agent) return 'failed';
  const refusal = await restartRefusal(orch, agent);
  if (refusal) return 'failed';
  await killAgent(orch, agent, null);
  const fresh = load()[masterId];
  const result = await restartAgent(fresh, fresh.agents.find((a) => a.id === agentId), message, `Mode ${modeName(agent.mode)} : relance de ${agentId}`);
  if (result.ok) {
    if ((agent.provider || 'claude') === 'claude') verifyRelaunchedMode(masterId, agentId, load()[masterId].agents.find((a) => a.id === agentId).tmux, agent.mode);
    return 'relaunched';
  }
  const text = core.wakeText(agent, 'stopped', lastReport(agent.sessionId));
  const target = mutate(masterId, (o) => {
    const a = o.agents.find((x) => x.id === agentId);
    core.pushEvent(o, { type: 'lost', agent: agentId, text: `${agentId} arrêté pour changer de mode, relance impossible : ${core.oneLine(result.error, 120)}` }, Date.now());
    return wake(o, a, text);
  });
  if (target) enqueueMerged(target, text, 'orchestration');
  return 'failed';
}

// An idle Claude prompt gets Shift+Tab; when the cycle of that session has no such mode, the agent is
// restarted with --resume instead (an agent that finished its turn gets no message, so no new turn).
async function cycleOrRelaunch(masterId, agent, mode) {
  const outcome = await cycleSessionMode(agent.sessionId, mode);
  if (outcome === 'applied' || outcome === 'unchanged') return outcome;
  if (outcome === 'unreachable') return relaunchAgent(masterId, agent.id, '');
  if (outcome === 'interrupted') note(masterId, `${agent.id} : bascule interrompue, mode intermédiaire jusqu'à la fin de son tour, elle reprendra ensuite`, agent.id);
  return outcome === 'offline' ? 'recorded' : ['unreadable', 'busy', 'interrupted'].includes(outcome) ? 'deferred' : 'failed';
}

function runModeAction(masterId, entry) {
  const { agent, action, target, status } = entry;
  if (action === 'record') return 'recorded';
  if (action === 'defer') return 'deferred';
  if (action === 'relaunch') return relaunchAgent(masterId, agent.id, status === 'needs' ? modeMessage(target) : '');
  return cycleOrRelaunch(masterId, agent, target);
}

// Whether a mode setting needs to reach the team: it changed, or some agent or the master is out of step.
function modeOutOfStep(orch, mode) {
  return orch.settings.agentMode !== mode || !!orch.masterModePending || orch.agents.some((a) => a.modePending || a.mode !== modeCore.effectiveMode(a, mode));
}

// The new permission mode reaches the whole team, whatever the depth: every agent stores it (a resume
// uses it), and a live one switches when it is safe (an idle prompt, a blocked permission prompt),
// otherwise when its turn ends. An agent launched stricter than the setting keeps its own mode.
function propagateMode(masterId, mode) {
  return locked(async () => {
    attachPending();
    const orch = load()[masterId];
    if (!orch) return null;
    const panes = await livePanes();
    const { statuses, sessions } = liveStatuses(orch, panes);
    const rawMaster = readSession(masterId);
    const master = rawMaster ? effectiveStatus(rawMaster, panes, Date.now()) : null;
    const masterStatus = master && paneOf(master, panes) ? master.status : 'ended';
    const plan = orch.agents.map((agent) => {
      const target = modeCore.effectiveMode(agent, mode);
      const status = statuses[agent.id];
      const action = modeCore.agentModeAction({ provider: agent.provider || 'claude', status, permission: !!sessions[agent.id]?.permission });
      const inSync = agent.mode === target && !agent.modePending;
      const kept = target !== mode;
      return { agent, target, status, kept, action: inSync && action !== 'cycle' ? 'skip' : action };
    });
    mutate(masterId, (o) => {
      for (const a of o.agents) a.mode = modeCore.effectiveMode(a, mode);
    });
    const outcomes = new Map();
    const settle = (entry, outcome) => outcomes.set(entry.agent.id, entry.kept && ['unchanged', 'recorded'].includes(outcome) ? 'kept' : outcome);
    await Promise.all([
      ...plan.filter((p) => p.action !== 'relaunch').map(async (p) => settle(p, p.action === 'skip' ? 'unchanged' : await runModeAction(masterId, p))),
      (async () => {
        const action = modeCore.masterModeAction(masterStatus);
        outcomes.set('master', action === 'record' ? 'recorded' : action === 'cycle' ? await cycleMaster(masterId, mode) : 'deferred');
      })(),
    ]);
    for (const p of plan.filter((x) => x.action === 'relaunch')) settle(p, await runModeAction(masterId, p));
    const masterDone = ['applied', 'unchanged', 'recorded'].includes(outcomes.get('master'));
    mutate(masterId, (o) => {
      for (const a of o.agents) {
        if (['deferred', 'failed'].includes(outcomes.get(a.id))) a.modePending = true;
        else if (outcomes.has(a.id)) delete a.modePending;
      }
      if (masterDone || outcomes.get('master') === 'unreachable') delete o.masterModePending;
      else o.masterModePending = mode;
    });
    const masterOutcome = outcomes.get('master') === 'unreachable' ? 'failed' : outcomes.get('master');
    return modeCore.modeSummary(mode, orch.agents.map((a) => outcomes.get(a.id)), masterOutcome);
  });
}

// The master is never restarted: a mode its cycle does not offer is left to the user.
async function cycleMaster(masterId, mode) {
  const outcome = await cycleSessionMode(masterId, mode);
  if (outcome === 'applied' || outcome === 'unchanged' || outcome === 'unreachable') return outcome;
  if (outcome === 'interrupted') note(masterId, 'Bascule du maître interrompue, mode intermédiaire jusqu\'à la fin de son tour, elle reprendra ensuite');
  return outcome === 'offline' ? 'recorded' : ['unreadable', 'busy', 'interrupted'].includes(outcome) ? 'deferred' : 'failed';
}

// A deferred switch comes due when the agent's turn ends (idle prompt) or when it hits a permission prompt.
function applyPendingMode(masterId, agentId, eventType) {
  return locked(async () => {
    const orch = load()[masterId];
    const agent = orch?.agents.find((a) => a.id === agentId);
    if (!agent?.modePending) return;
    const action = modeCore.pendingModeAction({ provider: agent.provider || 'claude', eventType });
    const outcome = action === 'relaunch' ? await relaunchAgent(masterId, agentId, eventType === 'done' ? '' : modeMessage(agent.mode)) : await cycleOrRelaunch(masterId, agent, agent.mode);
    if (outcome === 'deferred') return;
    const done = ['applied', 'unchanged', 'relaunched', 'recorded'].includes(outcome);
    mutate(masterId, (o) => {
      if (done) delete o.agents.find((a) => a.id === agentId).modePending;
      if (done) core.pushEvent(o, { type: 'settings', agent: agentId, text: `${agentId} passe en ${modeName(agent.mode)}` }, Date.now());
    });
  });
}

function applyPendingMasterMode(masterId) {
  return locked(async () => {
    const mode = load()[masterId]?.masterModePending;
    if (!mode) return;
    const outcome = await cycleMaster(masterId, mode);
    if (outcome === 'deferred') return;
    const done = ['applied', 'unchanged', 'recorded'].includes(outcome);
    mutate(masterId, (o) => {
      delete o.masterModePending;
      core.pushEvent(o, { type: 'settings', text: done ? `Le maître passe en ${modeName(mode)}` : `Le maître n'a pas pu passer en ${modeName(mode)} : Maj+Tab dans son terminal` }, Date.now());
    });
  });
}

// Every agent that is not stopped hears about the new autonomy level with the next message it receives;
// a stopped one reads it in its rules on resume.
async function notifyAutonomy(orch) {
  const { statuses } = liveStatuses(orch, await livePanes());
  const routes = new Map(orch.agents.map((a) => [a.id, core.noticeRoute(statuses[a.id])]));
  mutate(orch.masterSessionId, (o) => {
    for (const a of o.agents) if (routes.get(a.id) === 'next-message') a.noticePending = true;
  });
  const values = [...routes.values()];
  return { nextMessage: values.filter((r) => r === 'next-message').length, onResume: values.filter((r) => r === 'resume').length };
}

function notifiedText({ nextMessage, onResume }) {
  const parts = [];
  if (nextMessage) parts.push(`${nextMessage} agent${nextMessage > 1 ? 's' : ''} le recevront avec leur prochain message`);
  if (onResume) parts.push(`${onResume} arrêté${onResume > 1 ? 's' : ''} le liront à la reprise`);
  return parts.join(', ') || 'aucun agent';
}

async function updateSettings({ master, ...input }) {
  const orch = load()[String(master || '')];
  if (!orch) return { error: 'Maître inconnu.' };
  const normalized = core.normalizeSettings(input, orch.settings);
  if (normalized.error) return normalized;
  const mode = normalized.settings.agentMode;
  const propagate = input.agentMode !== undefined && modeOutOfStep(orch, mode);
  const autonomyChanged = normalized.settings.autonomy !== orch.settings.autonomy;
  mutate(orch.masterSessionId, (o) => {
    o.settings = normalized.settings;
  });
  const modeText = propagate ? await propagateMode(orch.masterSessionId, mode) : null;
  const notified = autonomyChanged ? await notifyAutonomy(load()[orch.masterSessionId] || orch) : null;
  mutate(orch.masterSessionId, (o) => {
    const autonomy = `autonomie ${normalized.settings.autonomy}${notified === null ? '' : ` (${notifiedText(notified)})`}`;
    core.pushEvent(o, { type: 'settings', text: `Réglages : ${normalized.settings.maxAgents} agents max, profondeur ${normalized.settings.maxDepth}, ${autonomy}, permissions ${modeText || modeName(mode)}` }, Date.now());
  });
  const modeNote = modeText ? `\nPermissions de tous les agents, et les tiennes : ${modeText}. Le cockpit l'applique lui-même, ne relance pas tes agents pour ça.` : '';
  const autonomyNote = notified === null ? '' : `\nNouveau niveau d'autonomie : le cockpit le transmet à tes agents (${notifiedText(notified)}), n'envoie rien de plus pour ça.`;
  await deliver(orch.masterSessionId, `[cockpit] L'utilisateur a changé tes réglages.\n${core.masterSystemPrompt({ settings: normalized.settings, root: ROOT })}${modeNote}${autonomyNote}`, true);
  return { ok: true, modes: modeText, notified: notified && notified.nextMessage, onResume: notified && notified.onResume };
}

function endOrchestration({ master, stopAgents }) {
  return locked(async () => {
    const orch = load()[String(master || '')];
    if (!orch) return { error: 'Maître inconnu.' };
    if (stopAgents) for (const agent of orch.agents) if (!agent.stoppedAt) await killAgent(orch, agent, 'Tu as arrêté');
    mutate(orch.masterSessionId, (o) => {
      o.endedAt = Date.now();
    });
    return { ok: true };
  });
}

// A new job on the same master: the current orchestration is archived (readable as history, kept 7 days
// like any ended one) and a blank one replaces it. Agents that only finished their turn are stopped,
// agents still working make the command refuse so that no work is cut off.
function newJob({ caller, goal }) {
  return locked(async () => {
    const found = resolveCaller(load(), caller);
    if (found.error) return found;
    if (found.agent) return { error: 'Seul le maître ouvre un nouveau job.' };
    const text = String(goal || '').trim();
    if (!text) return { error: 'Donne l\'objectif du nouveau job.' };
    const { orch } = found;
    const refusal = core.newJobRefusal(orch, liveStatuses(orch, await livePanes()).statuses);
    if (refusal) return { error: refusal, refused: true };
    for (const agent of orch.agents) if (!agent.stoppedAt) await killAgent(orch, agent, 'Nouveau job : arrêt de');
    const store = load();
    const current = store[orch.masterSessionId];
    if (!current || current.endedAt) return { error: 'Orchestration introuvable.' };
    const now = Date.now();
    core.pushEvent(current, { type: 'end', text: 'Job livré, nouveau job ouvert' }, now);
    const free = store[core.archiveKey(current)] ? core.nextJobNumber(store, current.masterSessionId) : core.jobNumber(current);
    const archived = { ...current, job: free, endedAt: now, archivedOf: current.masterSessionId };
    store[core.archiveKey(archived)] = archived;
    store[orch.masterSessionId] = core.freshJob(current, text, now, core.nextJobNumber(store, current.masterSessionId));
    save(store);
    dropQueued(orch.masterSessionId, 'orchestration');
    return { ok: true, job: store[orch.masterSessionId].job, archived: core.archiveKey(archived) };
  });
}

// The master rates an agent's work once it has checked it: the rating feeds the relevance matrix.
async function rateAgent({ caller, id, score, note, kind }) {
  const found = agentOf(load(), caller, id);
  if (found.error) {
    const live = resolveCaller(load(), caller);
    const archived = !live.error && Object.values(load()).some((o) => o.archivedOf === live.orch.masterSessionId && o.agents.some((a) => a.id === String(id)));
    return archived ? { error: `${id} appartient à un job archivé : note les agents avant « orchestrate new ».` } : found;
  }
  const checked = matrixCore.validateRating({ score, note });
  if (checked.error) return checked;
  const category = kind ? String(kind) : found.agent.kind;
  if (!category) return { error: `Donne la catégorie de tâche de ${found.agent.id} (--kind, voir orchestrate matrix).` };
  if (!matrix.categoryIds().includes(category)) return { error: `Catégorie inconnue : ${category}.` };
  const { agent, orch } = found;
  const rating = { at: Date.now(), category, provider: agent.provider || 'claude', model: agent.model || null, effort: agent.effort || null, score: checked.score, note: checked.note, agent: agent.id, master: orch.masterSessionId, job: core.jobNumber(orch), worktree: orch.worktree };
  matrix.recordRating(rating);
  mutate(orch.masterSessionId, (o) => {
    const target = o.agents.find((a) => a.id === agent.id);
    target.rating = { score: checked.score, note: checked.note, at: rating.at };
    if (!target.kind) target.kind = category;
    core.pushEvent(o, { type: 'rating', agent: agent.id, text: `${found.by} note ${agent.id} ${checked.score}/5${checked.note ? ` : ${core.oneLine(checked.note, 120)}` : ''}` }, Date.now());
  });
  return { ok: true };
}

async function rescorePick(body = {}) {
  const result = await matrix.rescorePick(body);
  if (result.error) return result;
  const live = resolveCaller(load(), body.caller);
  if (!live.error) {
    const label = `${body.provider === 'codex' ? 'GPT ' : ''}${body.model}·${body.effort || '-'}`;
    mutate(live.orch.masterSessionId, (o) => core.pushEvent(o, { type: 'rescore', text: `${live.agent?.id || 'maître'} réévalue ${label} à ${body.score}/5 en ${result.category} : ${core.oneLine(String(body.why), 120)}` }, Date.now()));
  }
  return { ok: true, category: result.category };
}

async function skillsForAgents() {
  const entries = (await skillEntries()).filter((e) => e.kind === 'skill');
  return [...new Map(entries.map((e) => [e.name, { name: e.name, description: core.excerpt(e.description, 200) }])).values()].sort((a, b) => a.name.localeCompare(b.name));
}

// Hands a report to the agent's parent, or to the master (held while the master is paused).
function wake(orch, agent, text) {
  const target = core.wakeTarget(orch, agent);
  if (target.hold) {
    orch.pendingWake = [...(orch.pendingWake || []), text];
    return null;
  }
  return target.sessionId;
}

// Called by the tick on each session transition: reports an agent's finished turn to whoever launched it.
function onSessionEvent(sessionId, event, session) {
  if (!['done', 'question', 'permission', 'needs_input'].includes(event.type)) return;
  const found = core.findBySession(load(), sessionId);
  if (found && !found.agent && event.type === 'done' && found.orch.masterModePending) applyPendingMasterMode(found.orch.masterSessionId).catch((error) => console.error('master mode failed', error));
  if (!found?.agent) return;
  if (found.agent.modePending && ['done', 'permission'].includes(event.type)) applyPendingMode(found.orch.masterSessionId, found.agent.id, event.type).catch((error) => console.error('agent mode failed', error));
  const now = Date.now();
  const report = event.type === 'done' ? lastReport(sessionId) || session?.lastAssistant : null;
  const target = mutate(found.orch.masterSessionId, (orch) => {
    const agent = orch.agents.find((a) => a.id === found.agent.id);
    if (event.type !== 'done') {
      core.pushEvent(orch, { type: 'needs', agent: agent.id, text: `${agent.id} attend ta réponse : ${core.oneLine(event.message, 160)}` }, now);
      return null;
    }
    core.pushEvent(orch, { type: 'done', agent: agent.id, text: `${agent.id} a fini : ${core.oneLine(report, 160)}` }, now);
    return wake(orch, agent, core.wakeText(agent, 'done', report));
  });
  if (target) enqueueMerged(target, core.wakeText(found.agent, 'done', report), 'orchestration');
}

// Called by the tick: an agent whose session died without being stopped (crash, closed pane) is
// reported once, so its master does not wait for a notification that will never come.
async function checkLostAgents(givenPanes) {
  const panes = givenPanes || (await livePanes());
  for (const orch of Object.values(load())) {
    if (orch.endedAt) continue;
    const { statuses } = liveStatuses(orch, panes);
    const lost = orch.agents.filter((a) => statuses[a.id] === 'stopped' && !a.stoppedAt && !a.lostAt);
    for (const agent of lost) {
      const report = lastReport(agent.sessionId);
      const text = core.wakeText(agent, 'stopped', report);
      const target = mutate(orch.masterSessionId, (o) => {
        const a = o.agents.find((x) => x.id === agent.id);
        a.lostAt = Date.now();
        core.pushEvent(o, { type: 'lost', agent: agent.id, text: `${agent.id} s'est arrêté sans avoir été stoppé` }, Date.now());
        return wake(o, a, text);
      });
      if (target) enqueueMerged(target, text, 'orchestration');
    }
  }
}

// Running agents keep their master "working" on its card, like background subagents.
function activeAgentsBySession(views) {
  const out = new Map();
  for (const v of Object.values(views)) out.set(v.masterSessionId, v.counts.working + v.counts.starting);
  return out;
}

module.exports = {
  modeChecks: () => Promise.all([...modeChecks]),
  startMaster, promote, setPlan, launchAgent, stopAgent, resumeAgent, sendToAgent, readAgent, status, orchestrations, orchestrationViews,
  setPaused, updateSettings, endOrchestration, newJob, skillsForAgents, rateAgent, rescorePick, onSessionEvent, checkLostAgents, activeAgentsBySession,
  lastReport, isolatedWorktree, readStore: load,
};
