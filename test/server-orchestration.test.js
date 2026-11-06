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

test('agentRefs keeps only what the board needs to hide finished agents', () => {
  const orch = orchWith([agent('w1', { sessionId: 's1', worktree: 'wt', brief: 'long brief' }), agent('w2', { parentId: 'w1', worktree: 'wt--w2', isolated: true, lostAt: 9 })], { masterSessionId: 'm', worktree: 'wt', endedAt: 5 });
  assert.deepStrictEqual(core.agentRefs(orch, { w1: 'stopped', w2: 'working' }), {
    masterSessionId: 'm',
    worktree: 'wt',
    agents: [
      { id: 'w1', status: 'stopped', parentId: null, sessionId: 's1', worktree: 'wt', stoppedAt: null, lost: false },
      { id: 'w2', status: 'working', parentId: 'w1', sessionId: null, worktree: 'wt--w2', stoppedAt: null, lost: true },
    ],
  });
});

test('agentRefs carries stoppedAt and lost so a crashed agent is told from a stopped one', () => {
  const orch = orchWith([agent('w1', { stoppedAt: 7 }), agent('w2', { lostAt: 9 })], { masterSessionId: 'm', worktree: 'wt' });
  const refs = core.agentRefs(orch, { w1: 'stopped', w2: 'stopped' }).agents;
  assert.deepStrictEqual(refs.map((a) => [a.stoppedAt, a.lost]), [[7, false], [null, true]]);
});

test('settledStatuses skips the live lookup only when every agent was stopped on purpose', () => {
  assert.deepStrictEqual(core.settledStatuses(orchWith([agent('w1', { stoppedAt: 1 }), agent('w2', { stoppedAt: 2 })])), { w1: 'stopped', w2: 'stopped' });
  assert.strictEqual(core.settledStatuses(orchWith([agent('w1', { stoppedAt: 1 }), agent('w2')])), null);
});
