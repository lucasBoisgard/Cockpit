const test = require('node:test');
const assert = require('node:assert');
const { isFinishedAgent, hiddenAgentIds, finishedScope, hiddenCountByRoot, isFinishedWorktree } = require('../web/js/finished-agents');

const agent = (id, status, extra = {}) => ({ id, status, parentId: null, sessionId: `s-${id}`, worktree: 'main-wt', phase: 0, stoppedAt: status === 'stopped' ? 10 : null, lostAt: null, ...extra });

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

test('an agent that died on its own is not finished: only a stop by the master or the user hides it', () => {
  assert.strictEqual(isFinishedAgent(agent('w1', 'stopped')), true);
  assert.strictEqual(isFinishedAgent(agent('w1', 'stopped', { lostAt: 20 })), false);
  assert.strictEqual(isFinishedAgent(agent('w1', 'stopped', { stoppedAt: null })), false);
  assert.strictEqual(hiddenAgentIds([agent('w1', 'stopped', { lostAt: 20 })]).size, 0);
});

test('an agent lost and then stopped on purpose is finished', () => {
  assert.strictEqual(isFinishedAgent(agent('w1', 'stopped', { lostAt: 5, stoppedAt: 10 })), true);
});

test('hiddenCountByRoot counts hidden agents under their top-level agent, even below a visible parent', () => {
  const agents = [agent('w1', 'working'), agent('w2', 'stopped', { parentId: 'w1' }), agent('w3', 'stopped', { parentId: 'w2' }), agent('w4', 'stopped'), agent('w5', 'stopped', { parentId: 'w4' })];
  const counts = hiddenCountByRoot(agents, hiddenAgentIds(agents));
  assert.deepStrictEqual([...counts], [['w1', 2], ['w4', 2]]);
});

test('isFinishedWorktree hides only an idle worktree whose sessions are all hidden agents', () => {
  const scope = { sessions: new Set(['a', 'b']), worktrees: new Set(['wt-x']) };
  const wt = (extra = {}) => ({ path: '/p/wt-x', name: 'wt-x', sessions: [{ sessionId: 'a' }, { sessionId: 'b' }], files: [], staged: 0, ahead: 0, unmerged: false, ...extra });
  assert.strictEqual(isFinishedWorktree(wt(), scope, null), true);
  assert.strictEqual(isFinishedWorktree(wt({ files: ['x'] }), scope, null), false);
  assert.strictEqual(isFinishedWorktree(wt({ staged: 1 }), scope, null), false);
  assert.strictEqual(isFinishedWorktree(wt({ ahead: 2 }), scope, null), false);
  assert.strictEqual(isFinishedWorktree(wt({ unmerged: true }), scope, null), false);
  assert.strictEqual(isFinishedWorktree(wt({ unmerged: undefined }), scope, null), false);
  assert.strictEqual(isFinishedWorktree(wt({ sessions: [] }), scope, null), false);
  assert.strictEqual(isFinishedWorktree(wt({ sessions: [{ sessionId: 'a' }, { sessionId: 'mine' }] }), scope, null), false);
  assert.strictEqual(isFinishedWorktree(wt(), scope, '/p/wt-x'), false);
  assert.strictEqual(isFinishedWorktree(wt({ name: 'other' }), scope, null), false);
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
