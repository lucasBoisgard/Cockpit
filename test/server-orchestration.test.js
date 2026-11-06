const test = require('node:test');
const assert = require('node:assert');
const core = require('../server/core/orchestration');

const orchWith = (agents = [], extra = {}) => ({ settings: { ...core.DEFAULT_SETTINGS }, phases: ['Explorer', 'Implémenter', 'Vérifier'], agents, events: [], paused: false, ...extra });
const agent = (id, extra = {}) => ({ id, name: id, phase: 0, parentId: null, skills: [], createdAt: 0, ...extra });

test('normalizeSettings keeps defaults and refuses a permission-skipping agent mode', () => {
  assert.deepStrictEqual(core.normalizeSettings({}).settings, core.DEFAULT_SETTINGS);
  assert.strictEqual(core.normalizeSettings({ maxAgents: '4', autonomy: 'milestones' }).settings.maxAgents, 4);
  assert.ok(core.normalizeSettings({ agentMode: 'bypassPermissions' }).error);
  assert.ok(core.normalizeSettings({ maxAgents: 0 }).error);
  assert.ok(core.normalizeSettings({ autonomy: 'never' }).error);
});

test('validatePhases trims names and refuses an empty plan', () => {
  assert.deepStrictEqual(core.validatePhases([' Explorer ', 'Livrer']).phases, ['Explorer', 'Livrer']);
  assert.ok(core.validatePhases([]).error);
  assert.ok(core.validatePhases(['ok', ' ']).error);
});

test('validateLaunch checks the agent settings and resolves a phase by name', () => {
  const orch = orchWith();
  const ok = core.validateLaunch({ name: 'Front', brief: 'Fais X', model: 'Sonnet', effort: 'high', skills: ['code-review'], phase: 'implémenter' }, orch);
  assert.deepStrictEqual(ok.agent, { name: 'Front', brief: 'Fais X', provider: 'claude', model: 'sonnet', effort: 'high', mode: 'acceptEdits', skills: ['code-review'], phase: 1, isolated: false });
  const gpt = core.validateLaunch({ name: 'GPT', brief: 'b', provider: 'codex', model: 'gpt-6-luna', effort: 'ultra' }, orch, ['gpt-6-luna']);
  assert.deepStrictEqual([gpt.agent.provider, gpt.agent.model, gpt.agent.effort, gpt.agent.mode], ['codex', 'gpt-6-luna', 'ultra', 'acceptEdits']);
  assert.ok(core.validateLaunch({ name: 'GPT', brief: 'b', provider: 'codex', model: 'opus' }, orch, ['gpt-6-luna']).error);
  assert.ok(core.validateLaunch({ name: 'x', brief: 'b', provider: 'gemini' }, orch).error);
  assert.ok(core.validateLaunch({ name: 'x', brief: '' }, orch).error);
  assert.ok(core.validateLaunch({ name: 'x', brief: 'b', model: 'gpt' }, orch).error);
  assert.ok(core.validateLaunch({ name: 'x', brief: 'b', mode: 'bypassPermissions' }, orch).error);
  assert.ok(core.validateLaunch({ name: 'x', brief: 'b', phase: 9 }, orch).error);
  assert.ok(core.validateLaunch({ name: 'x', brief: 'b', skills: ['rm -rf'] }, orch).error);
});

test('nextAgentId never reuses an id', () => {
  assert.strictEqual(core.nextAgentId(orchWith()), 'w1');
  assert.strictEqual(core.nextAgentId(orchWith([agent('w1'), agent('w3')])), 'w4');
});

test('agentStatus maps the agent session to the tree states', () => {
  const now = 100000;
  const a = agent('w1', { createdAt: now - 1000 });
  assert.strictEqual(core.agentStatus(a, null, { live: false, now }), 'starting');
  assert.strictEqual(core.agentStatus({ ...a, createdAt: 0 }, null, { live: false, now: core.START_GRACE_MS + 1 }), 'stopped');
  assert.strictEqual(core.agentStatus(a, { status: 'working', updatedAt: now }, { live: true, now }), 'working');
  assert.strictEqual(core.agentStatus(a, { status: 'needs_input' }, { live: true, now }), 'needs');
  assert.strictEqual(core.agentStatus(a, { status: 'done', lastAssistant: 'fini' }, { live: true, now }), 'done');
  assert.strictEqual(core.agentStatus(a, { status: 'done', agentsRunning: 2 }, { live: true, now }), 'working');
  assert.strictEqual(core.agentStatus(a, { status: 'working' }, { live: false, now }), 'stopped');
  assert.strictEqual(core.agentStatus({ ...a, stoppedAt: now - 10 }, { status: 'working', updatedAt: now - 20 }, { live: true, now }), 'stopped');
  assert.strictEqual(core.agentStatus({ ...a, stoppedAt: now - 10 }, { status: 'working', updatedAt: now }, { live: true, now }), 'working');
});

test('canLaunch enforces pause, the active-agent limit and the depth limit', () => {
  const agents = [agent('w1'), agent('w2', { parentId: 'w1' }), agent('w3')];
  const orch = orchWith(agents, { settings: { ...core.DEFAULT_SETTINGS, maxAgents: 2 } });
  assert.match(core.canLaunch({ ...orch, paused: true }, {}, null), /pause/);
  assert.match(core.canLaunch(orch, { w1: 'working', w2: 'needs', w3: 'done' }, null), /2 agents actifs/);
  assert.strictEqual(core.canLaunch(orch, { w1: 'done', w2: 'done', w3: 'working' }, null), null);
  assert.match(core.canLaunch(orch, { w1: 'done', w2: 'done', w3: 'done' }, 'w2'), /Profondeur/);
  assert.strictEqual(core.canLaunch(orch, { w1: 'done', w2: 'done', w3: 'done' }, 'w1'), null);
});

test('currentPhase is the earliest phase with unfinished agents', () => {
  const orch = orchWith([agent('w1', { phase: 0 }), agent('w2', { phase: 1 }), agent('w3', { phase: 2 })]);
  assert.strictEqual(core.currentPhase(orch, { w1: 'done', w2: 'working', w3: 'starting' }), 1);
  assert.strictEqual(core.currentPhase(orch, { w1: 'done', w2: 'done', w3: 'stopped' }), 2);
  assert.strictEqual(core.currentPhase(orchWith(), {}), 0);
});

test('masterState puts the user first, then the pause, then running work', () => {
  const orch = orchWith([agent('w1'), agent('w2')]);
  assert.strictEqual(core.masterState(orch, 'done', { w1: 'needs', w2: 'working' }), 'needs');
  assert.strictEqual(core.masterState(orch, 'needs_input', { w1: 'done', w2: 'done' }), 'needs');
  assert.strictEqual(core.masterState({ ...orch, paused: true }, 'done', { w1: 'working', w2: 'done' }), 'paused');
  assert.strictEqual(core.masterState(orch, 'done', { w1: 'starting', w2: 'done' }), 'working');
  assert.strictEqual(core.masterState(orch, 'done', { w1: 'done', w2: 'stopped' }), 'done');
});

test('wakeText quotes a bounded excerpt of the report and points to the full one', () => {
  const text = core.wakeText(agent('w3', { name: 'Front' }), 'done', 'x'.repeat(5000));
  assert.match(text, /w3 « Front » a fini son tour/);
  assert.match(text, /orchestrate read w3/);
  assert.ok(text.length < 1700);
});

test('findBySession finds a master or the agent owning a session', () => {
  const store = { m1: { masterSessionId: 'm1', agents: [agent('w1', { sessionId: 's1' })] } };
  assert.strictEqual(core.findBySession(store, 'm1').agent, null);
  assert.strictEqual(core.findBySession(store, 's1').agent.id, 'w1');
  assert.strictEqual(core.findBySession(store, 'nope'), null);
});

test('the system prompts carry the CLI path, the autonomy rule and the agent rules', () => {
  const master = core.masterSystemPrompt({ settings: { ...core.DEFAULT_SETTINGS, maxAgents: 3 }, root: '/cockpit' });
  assert.match(master, /node \/cockpit\/bin\/orchestrate\.js/);
  assert.match(master, /At most 3 agents/);
  assert.match(master, new RegExp(core.AUTONOMY.blocking.slice(0, 30)));
  const shared = core.agentSystemPrompt({ agent: agent('w2', { skills: ['code-review'] }), masterWorktree: 'wt', isolated: false, root: '/cockpit' });
  assert.match(shared, /BLOQUÉ :/);
  assert.match(shared, /code-review/);
  assert.match(shared, /never run git commit/);
  const isolated = core.agentSystemPrompt({ agent: agent('w2'), masterWorktree: 'wt', isolated: true, branch: 'feat/x--w2', root: '/cockpit' });
  assert.match(isolated, /branch feat\/x--w2/);
});

test('findBySession ignores ended orchestrations', () => {
  const store = { m1: { masterSessionId: 'm1', endedAt: 5, agents: [agent('w1', { sessionId: 's1' })] } };
  assert.strictEqual(core.findBySession(store, 'm1'), null);
  assert.strictEqual(core.findBySession(store, 's1'), null);
});

test('wakeTarget sends a sub-agent report to its parent even while the master is paused', () => {
  const orch = orchWith([agent('w1', { sessionId: 's1' }), agent('w2', { sessionId: 's2', parentId: 'w1' })], { masterSessionId: 'm1', paused: true });
  assert.deepStrictEqual(core.wakeTarget(orch, orch.agents[1]), { sessionId: 's1', hold: false });
  assert.deepStrictEqual(core.wakeTarget(orch, orch.agents[0]), { sessionId: 'm1', hold: true });
  assert.deepStrictEqual(core.wakeTarget({ ...orch, paused: false }, orch.agents[0]), { sessionId: 'm1', hold: false });
});

test('validateLaunch refuses an explicit mode looser than the orchestration when the agent inherits it', () => {
  const orch = orchWith([], { settings: { ...core.DEFAULT_SETTINGS, agentMode: 'acceptEdits' } });
  const inherit = { inheritMode: true };
  assert.strictEqual(core.validateLaunch({ name: 'x', brief: 'b', mode: 'plan' }, orch, undefined, inherit).agent.mode, 'plan');
  assert.strictEqual(core.validateLaunch({ name: 'x', brief: 'b' }, orch, undefined, inherit).agent.mode, 'acceptEdits');
  assert.match(core.validateLaunch({ name: 'x', brief: 'b', mode: 'auto' }, orch, undefined, inherit).error, /refusé/);
  assert.strictEqual(core.validateLaunch({ name: 'maître', brief: 'b', mode: 'auto' }, orch).agent.mode, 'auto');
});

test('agentSystemPrompt names the real parent and carries the autonomy level', () => {
  const orch = orchWith([agent('w1', { name: 'Front' }), agent('w2', { parentId: 'w1' })], { settings: { ...core.DEFAULT_SETTINGS, autonomy: 'decisions' } });
  const child = core.agentSystemPrompt({ agent: orch.agents[1], orch, masterWorktree: 'wt', isolated: false, root: '/cockpit' });
  assert.match(child, /launched by agent w1 \("Front"\)/);
  assert.match(child, /Agent w1 \("Front"\), who launched you answers you/);
  assert.match(child, /read by agent w1/);
  assert.doesNotMatch(child, /The master answers you/);
  assert.match(child, new RegExp(core.AUTONOMY.decisions.slice(0, 30)));
  const top = core.agentSystemPrompt({ agent: orch.agents[0], orch, masterWorktree: 'wt', isolated: false, root: '/cockpit' });
  assert.match(top, /The master answers you/);
  assert.match(top, /read by the master/);
});

test('an agent at the maximum depth is not told it may launch sub-agents', () => {
  const orch = orchWith([agent('w1'), agent('w2', { parentId: 'w1' })]);
  assert.strictEqual(core.agentDepth(orch, orch.agents[0]), 1);
  assert.strictEqual(core.agentDepth(orch, orch.agents[1]), 2);
  assert.strictEqual(core.agentDepth(orch, agent('w3', { parentId: 'w2' })), 3);
  const shallow = core.agentSystemPrompt({ agent: orch.agents[0], orch, masterWorktree: 'wt', isolated: false, root: '/cockpit' });
  assert.match(shallow, /you may launch sub-agents/);
  const deep = core.agentSystemPrompt({ agent: orch.agents[1], orch, masterWorktree: 'wt', isolated: false, root: '/cockpit' });
  assert.doesNotMatch(deep, /you may launch sub-agents/);
  assert.match(deep, /maximum depth/);
  assert.strictEqual(core.canLaunchSubAgents(orch, agent('w9', { provider: 'codex' })), false);
});

test('a new agent about to be launched is counted one level below its parent', () => {
  const orch = orchWith([agent('w1'), agent('w2', { parentId: 'w1' })]);
  const fresh = agent('w3', { parentId: 'w2' });
  assert.strictEqual(core.canLaunchSubAgents(orch, fresh), false);
  assert.strictEqual(core.canLaunchSubAgents(orch, agent('w4', { parentId: 'w1' })), false);
  assert.strictEqual(core.canLaunchSubAgents(orch, agent('w5')), true);
});

test('autonomyNotice carries the new level', () => {
  assert.match(core.autonomyNotice('milestones'), new RegExp(core.AUTONOMY.milestones.slice(0, 30)));
  assert.match(core.autonomyNotice('milestones'), /^\[cockpit\]/);
});

test('noticeRoute never pastes into a running session: next message, or the rules on resume', () => {
  for (const status of ['working', 'done', 'needs', 'starting']) assert.strictEqual(core.noticeRoute(status), 'next-message');
  assert.strictEqual(core.noticeRoute('stopped'), 'resume');
});
