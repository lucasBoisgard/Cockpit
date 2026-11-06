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

const { transcriptSessionId, sessionUsageMap, withoutOrchestrated } = require('../server/core/usage-orchestration');
const entry = (sessionId, day) => ({ sessionId, days: new Map([['2026-11-06', day]]) });
const day = (input, output = 0) => ({ input, cacheWrite: 0, cacheRead: 0, output });

test('F1: a Task sub-agent transcript belongs to its parent session', () => {
  assert.strictEqual(transcriptSessionId('/p/proj/abc-123.jsonl'), 'abc-123');
  assert.strictEqual(transcriptSessionId('/p/proj/abc-123/subagents/agent-9f.jsonl'), 'abc-123');
});

test('F1: sub-agent tokens are summed into their session total', () => {
  const map = sessionUsageMap([entry('s1', day(10, 1)), entry('s1', day(5, 2)), entry('s2', day(3))], [{ sessionId: 's1', costUsd: 2 }]);
  assert.strictEqual(map.get('s1').totals.input, 15);
  assert.strictEqual(map.get('s1').totals.output, 3);
  assert.strictEqual(map.get('s1').costUsd, 2);
  assert.strictEqual(map.get('s2').costUsd, null);
});

test('F2: the cost is marked partial when some sessions have none', () => {
  const store = { m1: { masterSessionId: 'm1', job: 1, createdAt: 0, agents: [{ id: 'w1', name: 'a', sessionId: 's1' }, { id: 'w2', name: 'b', sessionId: 's2' }] } };
  const usage = new Map([['m1', { ...t(1), costUsd: 1 }], ['s1', { ...t(1), costUsd: 2 }], ['s2', t(1)]]);
  const [g] = groupOrchestrations(store, usage, NOW);
  assert.strictEqual(g.costUsd, 3);
  assert.strictEqual(g.costMissing, 1);
});

test('F3: orchestrated sessions leave the plain list before the cap', () => {
  const sessions = ['a', 'b', 'c', 'd'].map((sessionId) => ({ sessionId }));
  assert.deepStrictEqual(withoutOrchestrated(sessions, new Set(['a', 'b']), 2).map((s) => s.sessionId), ['c', 'd']);
});

test('F4: a session shared by two rows is counted once', () => {
  const store = { m1: { masterSessionId: 'm1', job: 1, createdAt: 0, agents: [{ id: 'w1', name: 'a', sessionId: 'm1' }, { id: 'w2', name: 'b', sessionId: 's2' }, { id: 'w3', name: 'c', sessionId: 's2' }] } };
  const [g] = groupOrchestrations(store, new Map([['m1', t(10)], ['s2', t(5)]]), NOW);
  assert.strictEqual(g.tokens, 15);
  assert.strictEqual(g.withoutUsage, 0);
});

test('F5: a group is partial when a row lacks data and empty when none has any', () => {
  const store = { m1: { masterSessionId: 'm1', job: 1, createdAt: 0, agents: [{ id: 'w1', name: 'a', sessionId: 'old' }] } };
  const [partial] = groupOrchestrations(store, new Map([['m1', t(4)]]), NOW);
  assert.strictEqual(partial.partial, true);
  assert.strictEqual(partial.hasUsage, true);
  const [empty] = groupOrchestrations(store, new Map(), NOW);
  assert.strictEqual(empty.hasUsage, false);
});
