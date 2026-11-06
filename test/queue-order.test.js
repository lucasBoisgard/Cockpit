const test = require('node:test');
const assert = require('node:assert');
const { queueGroupOf, queueGroups, queueFlat } = require('../web/js/queue-order');

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
