const test = require('node:test');
const assert = require('node:assert');
const { normalizeAutomation, nextRunOf, automationDue, automationWorktree } = require('../server/core/automations');

const MIN = 60000;
const PARIS = -60;
const daily = (extra = {}) => ({ enabled: true, tzOffsetMin: PARIS, schedule: { type: 'daily', time: '09:00', days: [1, 2, 3, 4, 5] }, createdAt: 0, lastRun: null, ...extra });
const mondaySlot = Date.UTC(2026, 10, 2, 8, 0);

test('automationDue fires a daily slot once, in the automation time zone, on its days only', () => {
  assert.ok(!automationDue(daily(), mondaySlot - MIN));
  assert.ok(automationDue(daily(), mondaySlot));
  assert.ok(automationDue(daily(), mondaySlot + 3 * 3600000));
  assert.ok(!automationDue(daily({ lastRun: mondaySlot + MIN }), mondaySlot + 2 * MIN));
  assert.ok(!automationDue(daily({ createdAt: mondaySlot + MIN }), mondaySlot + 2 * MIN));
  assert.ok(!automationDue(daily(), Date.UTC(2026, 10, 7, 8, 30)));
  assert.ok(!automationDue(daily({ enabled: false }), mondaySlot));
});

test('automationDue runs an interval when never run or after the interval', () => {
  const every = (lastRun) => ({ enabled: true, tzOffsetMin: 0, schedule: { type: 'interval', minutes: 30 }, lastRun });
  assert.ok(automationDue(every(null), 1000));
  assert.ok(!automationDue(every(1000), 1000 + 29 * MIN));
  assert.ok(automationDue(every(1000), 1000 + 30 * MIN));
});

test('nextRunOf gives the next daily slot, skipping days off and slots already run', () => {
  assert.strictEqual(nextRunOf(daily(), mondaySlot - 3600000), mondaySlot);
  assert.strictEqual(nextRunOf(daily({ lastRun: mondaySlot + MIN }), mondaySlot + 2 * MIN), mondaySlot + 86400000);
  assert.strictEqual(nextRunOf(daily({ lastRun: mondaySlot + 4 * 86400000 + MIN }), mondaySlot + 4 * 86400000 + 2 * MIN), mondaySlot + 7 * 86400000);
  assert.strictEqual(nextRunOf(daily(), mondaySlot + 3600000), mondaySlot + 3600000);
  assert.strictEqual(nextRunOf(daily({ enabled: false }), mondaySlot), null);
  assert.strictEqual(nextRunOf(daily({ schedule: { type: 'daily', time: '09:00', days: [] } }), mondaySlot), null);
});

test('nextRunOf for intervals', () => {
  const every = (lastRun) => ({ enabled: true, schedule: { type: 'interval', minutes: 30 }, lastRun });
  assert.strictEqual(nextRunOf(every(null), 500), 500);
  assert.strictEqual(nextRunOf(every(1000), 2000), 1000 + 30 * MIN);
  assert.strictEqual(nextRunOf(every(1000), 1000 + 40 * MIN), 1000 + 40 * MIN);
});

test('automationWorktree stamps a new worktree with the local date and time', () => {
  assert.strictEqual(automationWorktree({ worktree: 'nightly', newWorktree: false, tzOffsetMin: PARIS }, mondaySlot), 'nightly');
  assert.strictEqual(automationWorktree({ worktree: 'nightly', newWorktree: true, tzOffsetMin: PARIS }, mondaySlot), 'nightly-11020900');
});

test('normalizeAutomation validates the item', () => {
  const ok = { name: 'n', worktree: 'wt', prompt: 'p', schedule: { type: 'interval', minutes: 10 } };
  assert.deepStrictEqual(normalizeAutomation({ ...ok, name: ' ' }, [], 'id', 1), { error: 'Nom et prompt obligatoires.' });
  assert.deepStrictEqual(normalizeAutomation({ ...ok, worktree: 'a/b' }, [], 'id', 1), { error: 'Nom de worktree invalide.' });
  assert.deepStrictEqual(normalizeAutomation({ ...ok, schedule: { type: 'daily', time: '9:00' } }, [], 'id', 1), { error: 'Heure invalide (HH:MM).' });
  assert.deepStrictEqual(normalizeAutomation({ ...ok, schedule: { type: 'interval', minutes: 5 } }, [], 'id', 1), { error: 'Intervalle de 10 minutes minimum.' });
  assert.deepStrictEqual(normalizeAutomation({ ...ok, schedule: { type: 'cron' } }, [], 'id', 1), { error: 'Planification invalide.' });
  assert.deepStrictEqual(normalizeAutomation(undefined, [], 'id', 1), { error: 'Nom et prompt obligatoires.' });
});

test('normalizeAutomation creates with defaults and keeps run history on update', () => {
  const item = { name: ' n ', worktree: 'wt', prompt: 'p', tzOffsetMin: 'x', schedule: { type: 'daily', time: '07:30', days: ['1', 9] } };
  assert.deepStrictEqual(normalizeAutomation(item, [], 'new', 42).automation, {
    id: 'new',
    name: 'n',
    provider: 'claude',
    worktree: 'wt',
    newWorktree: false,
    prompt: 'p',
    enabled: true,
    tzOffsetMin: 0,
    schedule: { type: 'daily', time: '07:30', days: [1] },
    createdAt: 42,
    lastRun: null,
    lastWorktree: null,
    lastOk: null,
    lastResult: null,
  });
  const existing = { id: 'old', createdAt: 7, lastRun: 8, lastWorktree: 'wt', lastOk: false, lastResult: 'r' };
  const updated = normalizeAutomation({ ...item, id: 'old', enabled: false }, [existing], 'new', 42).automation;
  assert.deepStrictEqual([updated.id, updated.enabled, updated.createdAt, updated.lastRun, updated.lastOk, updated.lastResult], ['old', false, 7, 8, false, 'r']);
  assert.strictEqual(normalizeAutomation({ ...item, id: 'unknown' }, [existing], 'new', 42).automation.id, 'new');
  assert.strictEqual(normalizeAutomation({ ...item, provider: 'codex' }, [], 'new', 42).automation.provider, 'codex');
  assert.ok(normalizeAutomation({ ...item, provider: 'unknown' }, [], 'new', 42).error);
  assert.deepStrictEqual(normalizeAutomation({ ...item, schedule: { type: 'daily', time: '07:30' } }, [], 'new', 42).automation.schedule.days, [1, 2, 3, 4, 5]);
});
