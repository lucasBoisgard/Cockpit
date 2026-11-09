const test = require('node:test');
const assert = require('node:assert');
const { SEEN_TURNS_MAX, isTurnRead, markTurnRead } = require('../web/js/read-turns');
const { queueGroupOf, queueGroups } = require('../web/js/queue-order');

const done = (sessionId, statusSince) => ({ sessionId, status: 'done', statusSince });

test('a finished turn is unread until opened, then read', () => {
  const s = done('a', 100);
  assert.strictEqual(isTurnRead(s, {}), false);
  assert.strictEqual(isTurnRead(s, markTurnRead(s, {})), true);
});

test('a newer finished turn is unread again', () => {
  const seen = markTurnRead(done('a', 100), {});
  assert.strictEqual(isTurnRead(done('a', 200), seen), false);
});

test('only finished turns can be read', () => {
  for (const status of ['working', 'needs_input', 'idle']) {
    const s = { sessionId: 'a', status, statusSince: 100 };
    assert.strictEqual(isTurnRead(s, { a: 999 }), false);
    assert.deepStrictEqual(markTurnRead(s, {}), {});
  }
  assert.strictEqual(isTurnRead(null, {}), false);
});

test('marking an already read turn keeps the same object', () => {
  const seen = markTurnRead(done('a', 100), {});
  assert.strictEqual(markTurnRead(done('a', 100), seen), seen);
});

test('the seen map keeps the most recent turns when it overflows', () => {
  let seen = {};
  for (let i = 0; i <= SEEN_TURNS_MAX; i++) seen = markTurnRead(done(`s${i}`, i + 1), seen);
  assert.strictEqual(Object.keys(seen).length, SEEN_TURNS_MAX);
  assert.strictEqual(seen.s0, undefined);
  assert.strictEqual(seen[`s${SEEN_TURNS_MAX}`], SEEN_TURNS_MAX + 1);
});

test('a read turn leaves "À relire" for the "Lu" group, after work in progress', () => {
  assert.strictEqual(queueGroupOf('done', true), 'read');
  assert.strictEqual(queueGroupOf('done', false), 'review');
  assert.strictEqual(queueGroupOf('working', true), 'working');
  const groups = queueGroups([
    { key: 'r', status: 'done', read: true, activity: 9 },
    { key: 'u', status: 'done', activity: 1 },
    { key: 'w', status: 'working', activity: 5 },
  ]);
  assert.deepStrictEqual(groups.map((g) => [g.id, g.label, g.items.map((i) => i.key)]), [['review', 'À relire', ['u']], ['working', 'En cours', ['w']], ['read', 'Lu', ['r']]]);
});
