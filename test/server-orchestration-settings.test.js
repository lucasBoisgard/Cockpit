const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-orch-settings-'));
process.env.HOME = home;
fs.mkdirSync(path.join(home, '.claude', 'worktree-state'), { recursive: true });
const deliveries = [];
const queue = require('../server/features/queue');
queue.deliver = async (sessionId, text) => {
  deliveries.push({ sessionId, text });
  return sessionId === 'gone' ? 'offline' : 'sent';
};
const { updateSettings } = require('../server/features/orchestration');
const core = require('../server/core/orchestration');

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const storeFile = path.join(home, '.claude', 'worktree-orchestration.json');
const agent = (id, extra = {}) => ({ id, name: id, phase: 0, parentId: null, skills: [], createdAt: 0, sessionId: `s-${id}`, cwd: home, mode: 'acceptEdits', provider: 'claude', brief: 'b', ...extra });
const seed = (agents, settings = {}) => {
  deliveries.length = 0;
  fs.writeFileSync(storeFile, JSON.stringify({ m1: { masterSessionId: 'm1', worktree: 'wt', phases: [], paused: false, createdAt: 1, events: [], settings: { ...core.DEFAULT_SETTINGS, ...settings }, agents } }));
};
const saved = () => JSON.parse(fs.readFileSync(storeFile, 'utf8')).m1;

test('a new autonomy level reaches every agent that is not stopped, sub-agents included', async () => {
  seed([agent('w1'), agent('w2', { parentId: 'w1' }), agent('w3', { stoppedAt: 5 }), agent('w4', { sessionId: 'gone' })]);
  const result = await updateSettings({ master: 'm1', autonomy: 'decisions' });
  assert.strictEqual(result.notified, 2);
  const toAgents = deliveries.filter((d) => d.sessionId.startsWith('s-'));
  assert.deepStrictEqual(toAgents.map((d) => d.sessionId), ['s-w1', 's-w2']);
  assert.match(toAgents[0].text, new RegExp(core.AUTONOMY.decisions.slice(0, 30)));
  assert.match(saved().events.at(-1).text, /autonomie decisions \(2 agents prévenus\)/);
});

test('settings that leave the autonomy as it was notify no agent', async () => {
  seed([agent('w1')], { autonomy: 'milestones' });
  const result = await updateSettings({ master: 'm1', autonomy: 'milestones', maxAgents: 3 });
  assert.strictEqual(result.notified, null);
  assert.deepStrictEqual(deliveries.filter((d) => d.sessionId === 's-w1'), []);
  assert.match(saved().events.at(-1).text, /3 agents max, autonomie milestones, permissions/);
});

test('a new agent mode is stored on every agent, but a stricter launch override is kept', async () => {
  seed([agent('w1', { stoppedAt: 5 }), agent('w2', { parentId: 'w1', stoppedAt: 5 }), agent('w3', { mode: 'plan', modeOverride: true, stoppedAt: 5 })]);
  const result = await updateSettings({ master: 'm1', agentMode: 'auto' });
  assert.deepStrictEqual(saved().agents.map((a) => a.mode), ['auto', 'auto', 'plan']);
  assert.match(result.modes, /2 agents mis à jour, 1 gardent leur mode plus strict/);
  await updateSettings({ master: 'm1', agentMode: 'plan' });
  assert.deepStrictEqual(saved().agents.map((a) => [a.mode, !!a.modeOverride]), [['plan', false], ['plan', false], ['plan', false]]);
});
