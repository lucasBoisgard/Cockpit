const test = require('node:test');
const assert = require('node:assert');
const { hiddenAgentIds, finishedScope, agentsInSubtree } = require('../web/js/finished-agents');

const agent = (id, status, extra = {}) => ({ id, status, parentId: null, sessionId: `s-${id}`, worktree: 'main-wt', phase: 0, ...extra });

test('only stopped agents are hidden: done agents may still wait for an answer', () => {
  const hidden = hiddenAgentIds([agent('w1', 'stopped'), agent('w2', 'done'), agent('w3', 'working'), agent('w4', 'needs'), agent('w5', 'starting')]);
  assert.deepStrictEqual([...hidden], ['w1']);
});

test('a stopped parent stays visible while one of its children is not hidden', () => {
  const agents = [agent('w1', 'stopped'), agent('w2', 'working', { parentId: 'w1' }), agent('w3', 'stopped', { parentId: 'w1' })];
  assert.deepStrictEqual([...hiddenAgentIds(agents)], ['w3']);
});

test('a stopped parent is hidden once all its descendants are hidden', () => {
  const agents = [agent('w1', 'stopped'), agent('w2', 'stopped', { parentId: 'w1' }), agent('w3', 'stopped', { parentId: 'w2' })];
  assert.deepStrictEqual([...hiddenAgentIds(agents)].sort(), ['w1', 'w2', 'w3']);
});

test('a resumed agent is no longer hidden', () => {
  assert.strictEqual(hiddenAgentIds([agent('w1', 'starting')]).size, 0);
});

test('an agent whose parent is unknown is judged on its own status', () => {
  assert.deepStrictEqual([...hiddenAgentIds([agent('w2', 'stopped', { parentId: 'gone' })])], ['w2']);
});

test('agentsInSubtree counts every descendant', () => {
  const agents = [agent('w1', 'stopped'), agent('w2', 'stopped', { parentId: 'w1' }), agent('w3', 'stopped', { parentId: 'w2' }), agent('w4', 'stopped')];
  assert.strictEqual(agentsInSubtree(agents, 'w1'), 2);
  assert.strictEqual(agentsInSubtree(agents, 'w4'), 0);
});

test('finishedScope hides the sessions of stopped agents and their own worktrees, never the master worktree', () => {
  const orch = {
    worktree: 'main-wt',
    agents: [
      agent('w1', 'stopped'),
      agent('w2', 'stopped', { worktree: 'main-wt--ab-w2', isolated: true }),
      agent('w3', 'working', { worktree: 'main-wt--ab-w3', isolated: true }),
      agent('w4', 'stopped', { worktree: 'main-wt--ab-w3', parentId: 'w3' }),
    ],
  };
  const scope = finishedScope({ m: orch });
  assert.deepStrictEqual([...scope.sessions].sort(), ['s-w1', 's-w2', 's-w4']);
  assert.deepStrictEqual([...scope.worktrees], ['main-wt--ab-w2']);
  assert.strictEqual(scope.count, 3);
});

test('finishedScope copes with no orchestration', () => {
  assert.deepStrictEqual(finishedScope(undefined), { sessions: new Set(), worktrees: new Set(), count: 0 });
});

test('finishedScope also hides the stopped agents of ended orchestrations, but not those still running', () => {
  const ended = { m: { worktree: 'main-wt', agents: [agent('w1', 'stopped', { worktree: 'main-wt--x-w1' }), agent('w2', 'working', { worktree: 'main-wt--x-w2' })] } };
  const scope = finishedScope({}, ended);
  assert.deepStrictEqual([...scope.sessions], ['s-w1']);
  assert.deepStrictEqual([...scope.worktrees], ['main-wt--x-w1']);
});
