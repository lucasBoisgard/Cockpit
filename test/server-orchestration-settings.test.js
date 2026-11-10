const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-orch-settings-'));
process.env.HOME = home;
fs.mkdirSync(path.join(home, '.claude', 'worktree-state'), { recursive: true });

// tmux is simulated: a prompt whose Shift+Tab walks `cycle`, and a record of every call.
const sim = { calls: [], cycle: ['default', 'acceptEdits', 'plan'], index: 1, onPress: null };
const FOOTERS = { default: '? for shortcuts', acceptEdits: '⏵⏵ accept edits on (shift+tab to cycle)', plan: '⏸ plan mode on (shift+tab to cycle)', auto: '⏵⏵ auto mode on (shift+tab to cycle)' };
require('../server/io/exec').tmux = async (args) => {
  sim.calls.push(args);
  if (args[0] === 'capture-pane') return { ok: true, stdout: `❯ \n──────\n  ${FOOTERS[sim.cycle[sim.index]]}`, stderr: '' };
  if (args[0] === 'send-keys' && args.includes('BTab')) {
    sim.index = (sim.index + 1) % sim.cycle.length;
    if (sim.onPress) sim.onPress();
  }
  return { ok: true, stdout: '', stderr: '' };
};
const PANES = new Map(['%900001', '%900002', '%900003'].map((id) => [id, { session: 'x', created: 0 }]));
require('../server/features/worktrees').livePanes = async () => PANES;
const sent = [];
const delivered = [];
const queue = require('../server/features/queue');
queue.sendToSession = async (sessionId, text) => { sent.push({ sessionId, text }); return true; };
queue.deliver = async (sessionId, text) => { delivered.push({ sessionId, text }); return 'sent'; };
const { updateSettings, sendToAgent, resumeAgent, launchAgent, modeChecks, newJob, orchestrationViews, rateAgent, onSessionEvent } = require('../server/features/orchestration');
require('../server/features/agent-mode').timing.attempts = 2;
require('../server/features/agent-mode').timing.gapMs = 1;
const core = require('../server/core/orchestration');

const { after } = require('node:test');
after(() => fs.rmSync(home, { recursive: true, force: true }));
beforeEach(() => {
  for (const file of fs.readdirSync(path.join(home, '.claude', 'worktree-state'))) fs.rmSync(path.join(home, '.claude', 'worktree-state', file));
});

const dir = path.join(home, '.claude');
const writeState = (id, status, pane, extra = {}) => fs.writeFileSync(path.join(dir, 'worktree-state', `${id}.json`), JSON.stringify({ sessionId: id, cwd: home, status, updatedAt: Date.now(), startedAt: 1, lastAssistant: 'x', tmuxPane: pane, ...extra }));
const agent = (id, extra = {}) => ({ id, name: id, phase: 0, parentId: null, skills: [], createdAt: 0, sessionId: `s-${id}`, cwd: home, mode: 'acceptEdits', provider: 'claude', brief: 'b', ...extra });
const seed = (agents, extra = {}) => {
  sim.calls.length = 0;
  sim.index = 1;
  sim.onPress = null;
  sim.cycle = ['default', 'acceptEdits', 'plan'];
  fs.rmSync(path.join(home, '.claude', 'worktree-queue.json'), { force: true });
  sent.length = 0;
  delivered.length = 0;
  fs.writeFileSync(path.join(dir, 'worktree-orchestration.json'), JSON.stringify({ m1: { masterSessionId: 'm1', worktree: 'wt', phases: [], paused: false, createdAt: 1, events: [], settings: { ...core.DEFAULT_SETTINGS }, agents, ...extra } }));
};
const saved = () => JSON.parse(fs.readFileSync(path.join(dir, 'worktree-orchestration.json'), 'utf8')).m1;
const kills = () => sim.calls.filter((c) => c[0] === 'kill-pane');
const launches = () => sim.calls.filter((c) => c[0] === 'new-session');
const presses = () => sim.calls.filter((c) => c[0] === 'send-keys' && c.includes('BTab')).length;

test('a new autonomy level is pasted into no session: every live agent gets it with its next message', async () => {
  writeState('s-w1', 'working', '%900001');
  writeState('s-w2', 'done', '%900002');
  writeState('s-w4', 'needs_input', '%900003', { permission: true });
  seed([agent('w1'), agent('w2', { parentId: 'w1' }), agent('w3', { stoppedAt: 5 }), agent('w4')]);
  const result = await updateSettings({ master: 'm1', autonomy: 'decisions' });
  assert.deepStrictEqual(sent, []);
  assert.deepStrictEqual(delivered.filter((d) => d.sessionId.startsWith('s-')), []);
  assert.deepStrictEqual(sim.calls.filter((c) => c[0] === 'send-keys' || c[0] === 'paste-buffer'), []);
  assert.deepStrictEqual(saved().agents.map((a) => !!a.noticePending), [true, true, false, true]);
  assert.deepStrictEqual([result.notified, result.onResume], [3, 1]);
  assert.match(saved().events.at(-1).text, /autonomie decisions \(3 agents le recevront avec leur prochain message, 1 arrêté le liront à la reprise\)/);
  await sendToAgent({ caller: 'm1', id: 'w2', text: 'continue', by: 'user' });
  const toW2 = delivered.find((d) => d.sessionId === 's-w2');
  assert.match(toW2.text, new RegExp(`${core.AUTONOMY.decisions.slice(0, 30)}[\\s\\S]*continue`));
  assert.strictEqual(saved().agents[1].noticePending, undefined);
});

test('settings that leave the autonomy as it was notify no agent', async () => {
  writeState('s-w1', 'working', '%900001');
  seed([agent('w1')]);
  fs.writeFileSync(path.join(dir, 'worktree-orchestration.json'), JSON.stringify({ m1: { ...saved(), settings: { ...core.DEFAULT_SETTINGS, autonomy: 'milestones' } } }));
  const result = await updateSettings({ master: 'm1', autonomy: 'milestones', maxAgents: 3 });
  assert.strictEqual(result.notified, null);
  assert.deepStrictEqual(sent, []);
  assert.match(saved().events.at(-1).text, /3 agents max, profondeur 2, autonomie milestones, permissions/);
});

test('saving the same mode again touches no session', async () => {
  writeState('s-w2', 'done', '%900002');
  seed([agent('w2')]);
  const result = await updateSettings({ master: 'm1', agentMode: core.DEFAULT_SETTINGS.agentMode, maxAgents: 5 });
  assert.strictEqual(result.modes, null);
  assert.deepStrictEqual(sim.calls.filter((c) => c[0] !== 'list-panes'), []);
});

test('a new mode is stored on every agent; a stricter launch override keeps its own mode', async () => {
  seed([agent('w1', { stoppedAt: 5 }), agent('w2', { parentId: 'w1', stoppedAt: 5 }), agent('w3', { mode: 'plan', modeOverride: 'plan', stoppedAt: 5 })]);
  const result = await updateSettings({ master: 'm1', agentMode: 'auto' });
  assert.deepStrictEqual(saved().agents.map((a) => a.mode), ['auto', 'auto', 'plan']);
  assert.match(result.modes, /2 agents mis à jour, 1 gardent leur mode plus strict/);
  await updateSettings({ master: 'm1', agentMode: 'plan' });
  assert.deepStrictEqual(saved().agents.map((a) => a.mode), ['plan', 'plan', 'plan']);
  await updateSettings({ master: 'm1', agentMode: 'acceptEdits' });
  assert.deepStrictEqual(saved().agents.map((a) => a.mode), ['acceptEdits', 'acceptEdits', 'plan']);
});

test('an agent that works is not touched: its switch waits for the end of its turn', async () => {
  writeState('s-w1', 'working', '%900001');
  seed([agent('w1')]);
  const result = await updateSettings({ master: 'm1', agentMode: 'auto' });
  assert.strictEqual(presses(), 0);
  assert.deepStrictEqual([launches().length, kills().length], [0, 0]);
  assert.strictEqual(saved().agents[0].modePending, true);
  assert.match(result.modes, /1 à la fin de leur tour/);
});

test('an idle agent whose cycle has no auto is relaunched with --resume and no message', async () => {
  writeState('s-w2', 'done', '%900002');
  seed([agent('w2')]);
  const result = await updateSettings({ master: 'm1', agentMode: 'auto' });
  assert.strictEqual(sim.cycle[sim.index], 'acceptEdits');
  assert.strictEqual(kills().length, 1);
  const [launch] = launches();
  const mode = launch.indexOf('--permission-mode');
  assert.deepStrictEqual(launch.slice(mode, mode + 2), ['--permission-mode', 'auto']);
  assert.ok(launch.includes('--resume') && launch.includes('s-w2'));
  assert.ok(!launch.some((a) => String(a).startsWith('[cockpit]')));
  assert.match(result.modes, /1 agent mis à jour/);
});

test('an idle agent whose cycle has auto is switched by Shift+Tab, read back after each press', async () => {
  writeState('s-w2', 'done', '%900002');
  seed([agent('w2')]);
  sim.cycle = ['default', 'acceptEdits', 'plan', 'auto'];
  await updateSettings({ master: 'm1', agentMode: 'auto' });
  sim.cycle = ['default', 'acceptEdits', 'plan'];
  assert.strictEqual(presses(), 2);
  assert.deepStrictEqual([launches().length, kills().length], [0, 0]);
  const order = sim.calls.map((c) => (c[0] === 'capture-pane' ? 'read' : c.includes('BTab') ? 'press' : null)).filter(Boolean);
  assert.deepStrictEqual(order, ['read', 'press', 'read', 'press', 'read']);
});

test('a blocked agent is not killed when the orchestration is paused', async () => {
  writeState('s-w1', 'needs_input', '%900001', { permission: true });
  seed([agent('w1')], { paused: true });
  const result = await updateSettings({ master: 'm1', agentMode: 'auto' });
  assert.deepStrictEqual([kills().length, launches().length], [0, 0]);
  assert.strictEqual(saved().agents[0].modePending, true);
  assert.strictEqual(saved().agents[0].stoppedAt, undefined);
  assert.match(result.modes, /1 en échec/);
});

test('a blocked agent is not killed when the active-agent limit is already exceeded', async () => {
  writeState('s-w1', 'needs_input', '%900001', { permission: true });
  writeState('s-w2', 'working', '%900002');
  seed([agent('w1'), agent('w2')]);
  fs.writeFileSync(path.join(dir, 'worktree-orchestration.json'), JSON.stringify({ m1: { ...saved(), settings: { ...core.DEFAULT_SETTINGS, maxAgents: 1 } } }));
  await updateSettings({ master: 'm1', agentMode: 'auto' });
  assert.deepStrictEqual([kills().length, launches().length], [0, 0]);
  assert.strictEqual(saved().agents[0].modePending, true);
});

test('a blocked agent is relaunched in its conversation with the new mode and told about it', async () => {
  writeState('s-w1', 'needs_input', '%900001', { permission: true });
  seed([agent('w1')]);
  sim.cycle = ['auto'];
  sim.index = 0;
  await updateSettings({ master: 'm1', agentMode: 'auto' });
  assert.strictEqual(kills().length, 1);
  const [launch] = launches();
  assert.ok(launch.includes('--resume') && launch.includes('s-w1'));
  assert.deepStrictEqual(launch.slice(launch.indexOf('--permission-mode'), launch.indexOf('--permission-mode') + 2), ['--permission-mode', 'auto']);
  assert.match(launch.at(-1), /^\[cockpit\] Le mode de permission est passé à auto/);
  assert.strictEqual(saved().agents[0].modePending, undefined);
});

test('an idle agent with a message waiting in its queue is left for the end of its next turn', async () => {
  writeState('s-w2', 'done', '%900002');
  seed([agent('w2')]);
  fs.writeFileSync(path.join(dir, 'worktree-queue.json'), JSON.stringify({ 's-w2': [{ id: 'q1', text: 'hello', at: 1 }] }));
  sim.cycle = ['default', 'acceptEdits', 'plan', 'auto'];
  const result = await updateSettings({ master: 'm1', agentMode: 'auto' });
  assert.strictEqual(presses(), 0);
  assert.strictEqual(saved().agents[0].modePending, true);
  assert.match(result.modes, /1 à la fin de leur tour/);
});

test('a switch cut short by a new turn is reported and kept pending', async () => {
  writeState('s-w2', 'done', '%900002');
  seed([agent('w2')]);
  sim.cycle = ['default', 'acceptEdits', 'plan', 'auto'];
  sim.onPress = () => writeState('s-w2', 'working', '%900002');
  const result = await updateSettings({ master: 'm1', agentMode: 'auto' });
  assert.strictEqual(presses(), 1);
  assert.strictEqual(saved().agents[0].modePending, true);
  assert.match(result.modes, /1 à la fin de leur tour/);
  assert.ok(saved().events.some((e) => /w2 : bascule interrompue, mode intermédiaire/.test(e.text)));
});

test('after a relaunch the screen is read back, a different mode is reported and not retried', async () => {
  writeState('s-w1', 'needs_input', '%900001', { permission: true });
  seed([agent('w1')]);
  sim.cycle = ['acceptEdits'];
  sim.index = 0;
  await updateSettings({ master: 'm1', agentMode: 'auto' });
  await modeChecks();
  assert.match(sim.calls.filter((c) => c[0] === 'capture-pane').at(-1).join(' '), /cw-wt-w1-.*:/);
  assert.ok(saved().events.some((e) => /w1 relancé, mais son écran affiche accepter les modifs au lieu de auto/.test(e.text)));
  assert.strictEqual(saved().agents[0].modePending, undefined);
});

test('after a relaunch that shows the expected mode nothing is reported', async () => {
  writeState('s-w1', 'needs_input', '%900001', { permission: true });
  seed([agent('w1')]);
  sim.cycle = ['auto'];
  sim.index = 0;
  await updateSettings({ master: 'm1', agentMode: 'auto' });
  await modeChecks();
  assert.ok(!saved().events.some((e) => /au lieu de/.test(e.text)));
  assert.strictEqual(saved().agents[0].modePending, undefined);
});

test('a Codex agent cannot launch sub-agents', async () => {
  seed([agent('w1', { provider: 'codex', sessionId: 's-w1' })]);
  const result = await launchAgent({ caller: 's-w1', name: 'x', brief: 'b' });
  assert.match(result.error, /GPT \(Codex\)/);
  assert.strictEqual(launches().length, 0);
});

test('a resumed child is never looser than its parent, and resume ignores the depth limit', async () => {
  writeState('s-w1', 'done', '%900001');
  seed([agent('w1', { mode: 'plan' }), agent('w2', { parentId: 'w1', mode: 'auto', stoppedAt: 5 })], { settings: { ...core.DEFAULT_SETTINGS, agentMode: 'auto', maxDepth: 1 } });
  await resumeAgent({ caller: 'm1', id: 'w2', text: 'go', by: 'user' });
  assert.strictEqual(saved().agents[1].mode, 'plan');
  const [launch] = launches();
  const mode = launch.indexOf('--permission-mode');
  assert.deepStrictEqual(launch.slice(mode, mode + 2), ['--permission-mode', 'plan']);
});

const store = () => JSON.parse(fs.readFileSync(path.join(home, '.claude', 'worktree-orchestration.json'), 'utf8'));

test('a new job archives the current one, stops finished agents and opens a blank orchestration with the same settings', async () => {
  writeState('s-w1', 'done', '%900001');
  const settings = { ...core.DEFAULT_SETTINGS, maxAgents: 3 };
  seed([agent('w1')], { goal: 'old', phases: ['A'], settings });
  const result = await newJob({ caller: 'm1', goal: 'next job' });
  assert.deepStrictEqual([result.ok, result.job], [true, 2]);
  const all = store();
  const fresh = all.m1;
  assert.deepStrictEqual([fresh.goal, fresh.phases, fresh.agents, fresh.job, !!fresh.endedAt], ['next job', [], [], 2, false]);
  assert.deepStrictEqual(fresh.settings, settings);
  const archived = all['m1#job1'];
  assert.ok(archived.endedAt);
  assert.strictEqual(archived.archivedOf, 'm1');
  assert.ok(archived.agents[0].stoppedAt);
  assert.strictEqual(core.nextAgentId(fresh), 'w1');
  const views = await orchestrationViews();
  assert.deepStrictEqual(views.active.m1.history.map((j) => [j.job, j.goal]), [[1, 'old']]);
  assert.ok(views.ended['m1#job1']);
  assert.strictEqual(core.findBySession(all, 's-w1'), null);
});

test('a new job is refused while an agent works, and only the master can ask for it', async () => {
  writeState('s-w1', 'working', '%900001');
  seed([agent('w1')]);
  assert.match((await newJob({ caller: 'm1', goal: 'x' })).error, /w1/);
  assert.strictEqual(store()['m1#job1'], undefined);
  assert.ok((await newJob({ caller: 's-w1', goal: 'x' })).error);
  assert.ok((await newJob({ caller: 'm1', goal: ' ' })).error);
});

test('a second archived job gets its own key and the history lists both', async () => {
  seed([]);
  await newJob({ caller: 'm1', goal: 'two' });
  await newJob({ caller: 'm1', goal: 'three' });
  const all = store();
  assert.deepStrictEqual(Object.keys(all).sort(), ['m1', 'm1#job1', 'm1#job2']);
  assert.deepStrictEqual(core.jobHistory(all, 'm1').map((j) => j.job), [1, 2]);
});

test('F1: archives never reuse a key after the master is ended and promoted again', async () => {
  seed([], { goal: 'one' });
  await newJob({ caller: 'm1', goal: 'two' });
  const all = store();
  all.m1.endedAt = 5;
  fs.writeFileSync(path.join(home, '.claude', 'worktree-orchestration.json'), JSON.stringify({ ...all, m1: { ...all.m1, endedAt: undefined, job: undefined, goal: 'reborn' } }));
  await newJob({ caller: 'm1', goal: 'next' });
  const after = store();
  assert.strictEqual(after['m1#job1'].goal, 'one');
  const jobs = core.jobHistory(after, 'm1').map((j) => j.job);
  assert.strictEqual(new Set(jobs).size, 2);
  assert.ok(after.m1.job > Math.max(...jobs));
});

test('F2: a new job keeps the pause, and is refused while reports are held', async () => {
  seed([], { paused: true });
  assert.strictEqual((await newJob({ caller: 'm1', goal: 'x' })).ok, true);
  assert.strictEqual(store().m1.paused, true);
  seed([], { paused: true, pendingWake: ['w1 a fini'] });
  assert.match((await newJob({ caller: 'm1', goal: 'x' })).error, /reprends d'abord/);
  assert.strictEqual(store()['m1#job1'], undefined);
});

test('F3: rating an archived agent says so, and ratings carry their job', async () => {
  seed([agent('w1', { kind: 'implement' })]);
  await newJob({ caller: 'm1', goal: 'next' });
  assert.match((await rateAgent({ caller: 'm1', id: 'w1', score: 4, kind: 'implement' })).error, /job archivé/);
  seed([agent('w1')], { job: 3 });
  await rateAgent({ caller: 'm1', id: 'w1', score: 4, kind: 'implement' });
  const rated = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'worktree-matrix-ratings.json'), 'utf8'));
  assert.strictEqual([].concat(rated).pop().job, 3);
});

test('F4: reports queued for the master before a new job are dropped, and an archived agent wakes nobody', async () => {
  writeState('s-w1', 'done', '%900001');
  seed([agent('w1')]);
  queue.enqueueMerged('m1', 'w1 a fini : old', 'orchestration');
  queue.enqueueMerged('m1', 'user note', 'user');
  await newJob({ caller: 'm1', goal: 'next' });
  assert.deepStrictEqual((queue.loadQueues().m1 || []).map((i) => i.kind), ['user']);
  onSessionEvent('s-w1', { type: 'done' }, { lastAssistant: 'late' });
  assert.deepStrictEqual((queue.loadQueues().m1 || []).map((i) => i.kind), ['user']);
});

test('strictMaster defaults to true and accepts true, false and the string "false"', () => {
  const core = require('../server/core/orchestration');
  assert.strictEqual(core.normalizeSettings({}).settings.strictMaster, true);
  assert.strictEqual(core.normalizeSettings({ strictMaster: true }).settings.strictMaster, true);
  assert.strictEqual(core.normalizeSettings({ strictMaster: false }).settings.strictMaster, false);
  assert.strictEqual(core.normalizeSettings({ strictMaster: 'false' }).settings.strictMaster, false);
  assert.strictEqual(core.normalizeSettings({}, { strictMaster: false }).settings.strictMaster, false);
});

test('masterDisallowedTools lists the editing tools only when strict', () => {
  const core = require('../server/core/orchestration');
  assert.deepStrictEqual(core.masterDisallowedTools({ strictMaster: true }), ['Edit', 'Write', 'NotebookEdit', 'Agent']);
  assert.deepStrictEqual(core.masterDisallowedTools({ strictMaster: false }), []);
});

test('the master prompt always states the delegation role, the strict sentence only when strict', () => {
  const core = require('../server/core/orchestration');
  const strict = core.masterSystemPrompt({ settings: core.normalizeSettings({}).settings, root: '/r' });
  const loose = core.masterSystemPrompt({ settings: core.normalizeSettings({ strictMaster: false }).settings, root: '/r' });
  for (const text of [strict, loose]) {
    assert.match(text, /never to do the work/);
    assert.match(text, /Never use the internal Agent tool/);
    assert.match(text, /role-dispatcher/);
  }
  assert.match(strict, /disabled for you by the cockpit/);
  assert.doesNotMatch(loose, /disabled for you by the cockpit/);
});

test('a resumed master keeps its tool restriction only when it was launched restricted', () => {
  const { masterResumeDisallowed } = require('../server/features/orchestration');
  seed([], { masterRestricted: true });
  assert.deepStrictEqual(masterResumeDisallowed('m1'), core.masterDisallowedTools());
  seed([], { masterRestricted: false });
  assert.deepStrictEqual(masterResumeDisallowed('m1'), []);
  assert.deepStrictEqual(masterResumeDisallowed('unknown'), []);
});

test('settings stored before strictMaster existed read as strict and do not announce a change', async () => {
  const { strictMaster, ...legacy } = core.DEFAULT_SETTINGS;
  seed([], { settings: legacy });
  assert.strictEqual(strictMaster, true);
  assert.deepStrictEqual(core.masterDisallowedTools(legacy), core.masterDisallowedTools());
  await updateSettings({ master: 'm1', maxAgents: 4 });
  assert.ok(!delivered.at(-1).text.includes('Maître strict'));
});
