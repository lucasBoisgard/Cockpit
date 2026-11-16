const test = require('node:test');
const assert = require('node:assert');
const { queueGroupOf, queueGroups, queueFlat, queueByAttention } = require('../web/js/queue-order');

test('queueGroupOf maps session statuses to the attention groups', () => {
  assert.strictEqual(queueGroupOf('needs_input'), 'needs');
  assert.strictEqual(queueGroupOf('done'), 'review');
  assert.strictEqual(queueGroupOf('working'), 'working');
  for (const st of ['idle', 'ended', 'none', undefined]) assert.strictEqual(queueGroupOf(st), 'idle');
});

test('queueGroups orders groups by expected action and drops empty ones', () => {
  const groups = queueGroups([
    { key: 'a', status: 'idle', activity: 1 },
    { key: 'b', status: 'working', activity: 5 },
    { key: 'c', status: 'needs_input', since: 50 },
  ]);
  assert.deepStrictEqual(groups.map((g) => [g.id, g.label, g.items.map((i) => i.key)]), [['needs', 'À toi', ['c']], ['working', 'En cours', ['b']], ['idle', 'Au repos', ['a']]]);
});

test('requests wait oldest first, other groups show the latest activity first, pins lead', () => {
  const groups = queueGroups([
    { key: 'n1', status: 'needs_input', since: 300 },
    { key: 'n2', status: 'needs_input', since: 100 },
    { key: 'd1', status: 'done', activity: 10 },
    { key: 'd2', status: 'done', activity: 90 },
    { key: 'd3', status: 'done', activity: 5, pinned: true },
  ]);
  assert.deepStrictEqual(queueFlat(groups).map((i) => i.key), ['n2', 'n1', 'd3', 'd2', 'd1']);
});

test('sessions that cannot be closed form a block of their own at the end, whatever their status', () => {
  const groups = queueGroups([
    { key: 'main', status: 'needs_input', since: 1, fixed: true },
    { key: 'cockpit', status: 'working', activity: 9, fixed: true },
    { key: 'w', status: 'working', activity: 5 },
    { key: 'i', status: 'idle', activity: 1 },
  ]);
  assert.deepStrictEqual(groups.map((g) => [g.id, g.label, g.items.map((i) => i.key)]), [
    ['working', 'En cours', ['w']],
    ['idle', 'Au repos', ['i']],
    ['fixed', 'Sessions fixes', ['main', 'cockpit']],
  ]);
  assert.deepStrictEqual(queueFlat(groups).map((i) => i.key), ['w', 'i', 'main', 'cockpit']);
});

test('queueByAttention still counts a fixed session by what it needs from the user', () => {
  const groups = queueGroups([
    { key: 'main', status: 'needs_input', since: 1, fixed: true },
    { key: 'cockpit', status: 'done', fixed: true },
    { key: 'w', status: 'working' },
  ]);
  assert.deepStrictEqual(queueByAttention(groups, 'needs').map((i) => i.key), ['main']);
  assert.deepStrictEqual(queueByAttention(groups, 'review').map((i) => i.key), ['cockpit']);
  assert.deepStrictEqual(queueByAttention(groups, 'working').map((i) => i.key), ['w']);
});
