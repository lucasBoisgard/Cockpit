const test = require('node:test');
const assert = require('node:assert');
const { groupOrchestrations } = require('../server/core/usage-orchestration');

const t = (input, output = 0, cacheRead = 0, cacheWrite = 0) => ({ totals: { input, cacheWrite, cacheRead, output } });
const NOW = 100000;

test('a master alone makes a group with its own tokens', () => {
  const store = { m1: { masterSessionId: 'm1', worktree: 'wt', goal: 'g', model: 'opus', effort: 'high', job: 1, createdAt: 1000, agents: [] } };
  const [g] = groupOrchestrations(store, new Map([['m1', { ...t(10, 5), costUsd: 1.5 }]]), NOW);
  assert.strictEqual(g.agentCount, 0);
  assert.strictEqual(g.tokens, 15);
  assert.strictEqual(g.costUsd, 1.5);
  assert.strictEqual(g.rows.length, 1);
  assert.strictEqual(g.wallMs, 99000);
  assert.ok(g.active);
});

test('agents at depth 2 follow the tree order and sum into the totals', () => {
  const store = { m1: { masterSessionId: 'm1', job: 1, createdAt: 0, agents: [
    { id: 'w1', name: 'a', sessionId: 's1', model: 'sonnet', effort: 'low', kind: 'code', rating: { score: 4 } },
    { id: 'w2', name: 'b', sessionId: 's2', parentId: 'w1', model: 'haiku', effort: 'low' },
    { id: 'w3', name: 'c', sessionId: 's3', model: 'sonnet', effort: 'low' },
  ] } };
  const usage = new Map([['s1', t(100)], ['s2', t(10)], ['s3', t(1)]]);
  const [g] = groupOrchestrations(store, usage, NOW);
  assert.deepStrictEqual(g.rows.map((r) => [r.id, r.depth]), [['master', 0], ['w1', 1], ['w2', 2], ['w3', 1]]);
  assert.strictEqual(g.tokens, 111);
  assert.strictEqual(g.rows[1].rating, 4);
  assert.deepStrictEqual(g.models.map((m) => [m.model, m.tokens, m.agents]), [['sonnet', 101, 2], ['haiku', 10, 1]]);
});

test('archived jobs join the live one under the same master', () => {
  const store = {
    'm1#job1': { masterSessionId: 'm1', job: 1, createdAt: 0, endedAt: 10, archivedOf: 'm1', agents: [{ id: 'w1', name: 'a', sessionId: 's1' }] },
    m1: { masterSessionId: 'm1', job: 2, createdAt: 20, agents: [{ id: 'w1', name: 'b', sessionId: 's2' }] },
  };
  const [g] = groupOrchestrations(store, new Map([['s1', t(5)], ['s2', t(7)]]), 50);
  assert.strictEqual(g.agentCount, 2);
  assert.strictEqual(g.tokens, 12);
  assert.deepStrictEqual(g.rows.map((r) => r.job), [null, 1, 2]);
  assert.strictEqual(g.wallMs, 10 + 30);
  assert.strictEqual(g.jobs.length, 2);
});

test('GPT agents count under GPT', () => {
  const store = { m1: { masterSessionId: 'm1', job: 1, createdAt: 0, agents: [{ id: 'w1', name: 'a', provider: 'codex', sessionId: 's1', model: 'gpt-6-sol' }] } };
  const [g] = groupOrchestrations(store, new Map([['m1', t(20)], ['s1', t(30)]]), NOW);
  assert.deepStrictEqual(g.byProvider, { claude: 20, codex: 30 });
});

test('an agent without usage data stays listed and is counted apart', () => {
  const store = { m1: { masterSessionId: 'm1', job: 1, createdAt: 0, agents: [{ id: 'w1', name: 'a', sessionId: 'gone' }, { id: 'w2', name: 'b', sessionId: null }] } };
  const [g] = groupOrchestrations(store, new Map([['m1', t(4)]]), NOW);
  assert.strictEqual(g.tokens, 4);
  assert.strictEqual(g.withoutUsage, 2);
  assert.strictEqual(g.rows[1].totals, null);
  assert.strictEqual(g.costUsd, null);
});
