const test = require('node:test');
const assert = require('node:assert');
const { ago, span, statusAge, workedTime, duration, fmtTokens, fmtUsd } = require('../web/js/format.js');

const NOW = 1_800_000_000_000;

function frozen(t, fn) {
  t.mock.method(Date, 'now', () => NOW);
  fn();
}

test('ago switches unit at each threshold', (t) => frozen(t, () => {
  assert.strictEqual(ago(0), '');
  assert.strictEqual(ago(NOW), '0s');
  assert.strictEqual(ago(NOW + 5000), '0s');
  assert.strictEqual(ago(NOW - 59_000), '59s');
  assert.strictEqual(ago(NOW - 60_000), '1 min');
  assert.strictEqual(ago(NOW - 3_599_000), '60 min');
  assert.strictEqual(ago(NOW - 3_600_000), '1 h');
  assert.strictEqual(ago(NOW - 86_399_000), '24 h');
  assert.strictEqual(ago(NOW - 86_400_000), '1 j');
  assert.strictEqual(ago(NOW - 10 * 86_400_000), '10 j');
}));

test('span shows seconds, minutes, then hours and padded minutes', () => {
  assert.strictEqual(span(-5), '0 s');
  assert.strictEqual(span(59_000), '59 s');
  assert.strictEqual(span(60_000), '1 min');
  assert.strictEqual(span(3_599_000), '59 min');
  assert.strictEqual(span(3_600_000), '1 h 00');
  assert.strictEqual(span(3_725_000), '1 h 02');
});

test('duration shows seconds then minutes and padded seconds', () => {
  assert.strictEqual(duration(-1), '0 s');
  assert.strictEqual(duration(59_999), '59 s');
  assert.strictEqual(duration(60_000), '1 min 00');
  assert.strictEqual(duration(125_000), '2 min 05');
});

test('statusAge counts the running turn while working, the age otherwise', (t) => frozen(t, () => {
  assert.strictEqual(statusAge({ turnStartedAt: NOW - 90_000, statusSince: NOW - 600_000, updatedAt: NOW }, 'working'), '1 min');
  assert.strictEqual(statusAge({ statusSince: NOW - 120_000, updatedAt: NOW }, 'working'), '2 min');
  assert.strictEqual(statusAge({ status: 'done', statusSince: NOW - 7_200_000, updatedAt: NOW - 60_000 }, 'done'), 'il y a 2 h');
  assert.strictEqual(statusAge({ status: 'working', statusSince: NOW - 7_200_000, updatedAt: NOW - 60_000 }, 'idle'), 'il y a 1 min');
}));

test('workedTime adds the running turn only while working', (t) => frozen(t, () => {
  assert.strictEqual(workedTime(undefined, 'none'), 0);
  assert.strictEqual(workedTime({ workedMs: 5000, statusSince: NOW - 1000 }, 'done'), 5000);
  assert.strictEqual(workedTime({ workedMs: 5000, statusSince: NOW - 1000 }, 'working'), 6000);
  assert.strictEqual(workedTime({ updatedAt: NOW - 2000 }, 'working'), 2000);
}));

test('fmtTokens switches to k and M', () => {
  assert.strictEqual(fmtTokens(999), '999');
  assert.strictEqual(fmtTokens(1000), '1 k');
  assert.strictEqual(fmtTokens(1500), '2 k');
  assert.strictEqual(fmtTokens(1_234_567), '1,2 M');
  assert.strictEqual(fmtTokens(123_456_789), '123 M');
});

test('fmtUsd shows two decimals or a dash', () => {
  assert.strictEqual(fmtUsd(null), '—');
  assert.strictEqual(fmtUsd(undefined), '—');
  assert.strictEqual(fmtUsd(0.5), '0,50 $');
  assert.match(fmtUsd(1234.5), /^1\s234,50 \$$/);
});

test('a finished turn with background agents reads as agents at work, without counting working time', () => {
  const { backgroundOnly, statusLabel, statusAge, workedTime } = require('../web/js/format');
  const labels = { working: { label: 'En cours' }, done: { label: 'Terminé' } };
  const s = { status: 'done', agentsRunning: 2, workedMs: 1000, statusSince: 0, updatedAt: 0 };
  assert.strictEqual(backgroundOnly(s), true);
  assert.strictEqual(statusLabel(s, 'working', labels), 'Agents en arrière-plan');
  assert.strictEqual(statusAge(s, 'working'), '2 agents');
  assert.strictEqual(workedTime(s, 'working'), 1000);
  assert.strictEqual(backgroundOnly({ ...s, status: 'working' }), false);
  assert.strictEqual(statusLabel({ ...s, agentsRunning: 0 }, 'done', labels), 'Terminé');
});

test('pickPrimary follows the card status rules, background agents counting as working', () => {
  const { pickPrimary } = require('../web/js/format');
  const s = (sessionId, status, updatedAt, extra = {}) => ({ sessionId, status, updatedAt, live: true, ...extra });
  assert.strictEqual(pickPrimary([s('d', 'done', 3), s('bg', 'done', 1, { agentsRunning: 1 })]).sessionId, 'bg');
  assert.strictEqual(pickPrimary([s('w', 'working', 9), s('n', 'needs_input', 1)]).sessionId, 'n');
  assert.strictEqual(pickPrimary([s('old', 'needs_input', 9, { live: false }), s('d', 'done', 1)]).sessionId, 'd');
  assert.strictEqual(pickPrimary([s('x', 'needs_input', 1, { live: false }), s('y', 'done', 5, { live: false })]).sessionId, 'y');
});
