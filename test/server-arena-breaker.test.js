const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-arena-breaker-'));
process.env.HOME = home;
const dir = path.join(home, '.claude');
fs.mkdirSync(path.join(dir, 'worktree-state'), { recursive: true });
fs.mkdirSync(path.join(dir, 'worktree-usage'), { recursive: true });

const delivered = [];
const queue = require('../server/features/queue');
queue.deliver = async (sessionId, text) => { delivered.push({ sessionId, text }); return 'sent'; };
const { ARENA_LIMIT_PERCENT } = require('../server/config');
const { cutArenaIfOverLimit, guarded } = require('../server/features/arena-breaker');
const core = require('../server/core/orchestration');

after(() => fs.rmSync(home, { recursive: true, force: true }));

const OVER = ARENA_LIMIT_PERCENT;
const UNDER = ARENA_LIMIT_PERCENT - 10;
const window = (used) => ({ used_percentage: used, resets_at: Date.now() / 1000 + 3600 });
const writeUsage = (used) => fs.writeFileSync(path.join(dir, 'worktree-usage', 's1.json'), JSON.stringify({ sessionId: 's1', at: Date.now(), rateLimits: { five_hour: window(used), seven_day: window(1) } }));
const orch = (id, arena, extra = {}) => ({ masterSessionId: id, worktree: id, phases: [], paused: false, createdAt: 1, events: [], agents: [], settings: { ...core.DEFAULT_SETTINGS, arena }, ...extra });
const seed = (store) => fs.writeFileSync(path.join(dir, 'worktree-orchestration.json'), JSON.stringify(store));
const saved = () => JSON.parse(fs.readFileSync(path.join(dir, 'worktree-orchestration.json'), 'utf8'));
const ran = [];
const run = async (body) => { ran.push(body); return { ok: true }; };

beforeEach(() => {
  delivered.length = 0;
  ran.length = 0;
  fs.rmSync(path.join(dir, 'worktree-usage', 's1.json'), { force: true });
  fs.rmSync(path.join(dir, 'worktree-events.json'), { force: true });
  seed({});
});

test('reaching the threshold cuts Arena in every live orchestration and tells each master why', async () => {
  seed({ m1: orch('m1', true), m2: orch('m2', true), m3: orch('m3', false), m4: orch('m4', true, { endedAt: Date.now() }) });
  writeUsage(OVER);
  const cut = await cutArenaIfOverLimit();
  assert.deepStrictEqual(cut.sort(), ['m1', 'm2']);
  const store = saved();
  assert.deepStrictEqual(['m1', 'm2', 'm3', 'm4'].map((id) => store[id].settings.arena), [false, false, false, true]);
  assert.deepStrictEqual(delivered.map((d) => d.sessionId).sort(), ['m1', 'm2']);
  for (const d of delivered) {
    assert.match(d.text, /Mode Arène désactivé/);
    assert.match(d.text, new RegExp(`${OVER} %, seuil de ${ARENA_LIMIT_PERCENT} % atteint`));
    assert.match(d.text, /ne le réactive pas/);
  }
  assert.match(store.m1.events.at(-1).text, /mode Arène désactivé automatiquement : utilisation Claude \(5 h\)/);
  assert.match(JSON.parse(fs.readFileSync(path.join(dir, 'worktree-events.json'), 'utf8')).events.at(-1).message, /Mode Arène coupé sur 2 orchestrations/);
});

test('below the threshold nothing changes', async () => {
  seed({ m1: orch('m1', true) });
  writeUsage(UNDER);
  assert.deepStrictEqual(await cutArenaIfOverLimit(), []);
  assert.strictEqual(saved().m1.settings.arena, true);
  assert.deepStrictEqual(delivered, []);
});

test('absent limits change nothing', async () => {
  seed({ m1: orch('m1', true) });
  assert.deepStrictEqual(await cutArenaIfOverLimit(), []);
  assert.strictEqual(saved().m1.settings.arena, true);
  assert.deepStrictEqual(delivered, []);
});

test('usage going back down never turns Arena back on', async () => {
  seed({ m1: orch('m1', true) });
  writeUsage(OVER);
  await cutArenaIfOverLimit();
  writeUsage(UNDER);
  await cutArenaIfOverLimit();
  assert.strictEqual(saved().m1.settings.arena, false);
});

test('over the threshold, every way of switching Arena on is refused with the reason', async () => {
  writeUsage(OVER);
  seed({ m1: orch('m1', false) });
  const refusal = /^Mode Arène refusé : utilisation Claude \(5 h\)/;
  assert.match((await guarded.arena(run)({ caller: 'm1', on: true })).error, refusal);
  assert.match((await guarded.create(run)({ worktree: 'x', prompt: 'p', arena: true })).error, refusal);
  assert.match((await guarded.create(run)({ sessionId: 's', arena: 'true' })).error, refusal);
  assert.match((await guarded.settings(run)({ master: 'm1', arena: true })).error, refusal);
  assert.deepStrictEqual(ran, []);
});

test('over the threshold, switching Arena off and other changes still go through', async () => {
  writeUsage(OVER);
  seed({ m1: orch('m1', false), m2: orch('m2', true) });
  await guarded.arena(run)({ caller: 'm1', on: false });
  await guarded.create(run)({ worktree: 'x', prompt: 'p', arena: false });
  await guarded.settings(run)({ master: 'm1', arena: false, maxAgents: 3 });
  await guarded.settings(run)({ master: 'm2', arena: true, maxAgents: 3 });
  assert.strictEqual(ran.length, 4);
});

test('under the threshold, or without any reading, activation goes through', async () => {
  seed({ m1: orch('m1', false) });
  assert.deepStrictEqual(await guarded.arena(run)({ caller: 'm1', on: true }), { ok: true });
  writeUsage(UNDER);
  assert.deepStrictEqual(await guarded.settings(run)({ master: 'm1', arena: true }), { ok: true });
  assert.strictEqual(ran.length, 2);
});

test('the cut and the refusal read the same limits: a stale snapshot does neither', async () => {
  fs.writeFileSync(path.join(dir, 'worktree-usage', 's1.json'), JSON.stringify({ sessionId: 's1', at: Date.now() - 6 * 3600000, rateLimits: { five_hour: { used_percentage: 99 } } }));
  seed({ m1: orch('m1', true) });
  assert.deepStrictEqual(await cutArenaIfOverLimit(), []);
  assert.deepStrictEqual(await guarded.arena(run)({ caller: 'm1', on: true }), { ok: true });
});
