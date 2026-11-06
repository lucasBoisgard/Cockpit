const test = require('node:test');
const assert = require('node:assert');
const { masterOfSession, orchestrationOfSession, defaultSessionId, sessionPicker, composerTarget, groupWorktrees } = require('../web/js/master-first');

const orchs = {
  M: { masterSessionId: 'M', worktree: 'master-wt', agents: [
    { id: 'w1', sessionId: 'A1', worktree: 'wt-1', status: 'working' },
    { id: 'w2', sessionId: 'A2', worktree: 'wt-2', status: 'needs', parentId: 'w1' },
    { id: 'w3', sessionId: 'A3', worktree: 'master-wt', status: 'working' },
  ] },
};
const sess = (sessionId, extra = {}) => ({ sessionId, live: true, status: 'working', ...extra });
const wt = (name, sessions) => ({ name, path: `/p/${name}`, sessions });

test('the master is the default session of its worktree, even when an agent is more recent', () => {
  assert.strictEqual(defaultSessionId([sess('A3'), sess('M')], orchs, 'A3'), 'M');
});

test('a worktree without master keeps the fallback', () => {
  assert.strictEqual(defaultSessionId([sess('X')], orchs, 'X'), 'X');
  assert.strictEqual(defaultSessionId([], {}, null), null);
});

test('agents of every depth resolve to the master', () => {
  assert.strictEqual(masterOfSession('A2', orchs), 'M');
  assert.strictEqual(masterOfSession('M', orchs), null);
  assert.strictEqual(orchestrationOfSession('A1', orchs).masterSessionId, 'M');
  assert.strictEqual(orchestrationOfSession('M', orchs).masterSessionId, 'M');
});

test('the picker folds agents, keeps the selected one and counts those waiting', () => {
  const sessions = [sess('A3', { status: 'needs_input' }), sess('M'), sess('X')];
  const closed = sessionPicker(sessions, orchs, 'M', false);
  assert.deepStrictEqual(closed.peers.map((s) => s.sessionId), ['M', 'X']);
  assert.strictEqual(closed.shownAgents.length, 0);
  assert.strictEqual(closed.hiddenCount, 1);
  assert.strictEqual(closed.needs, 1);
  assert.strictEqual(sessionPicker(sessions, orchs, 'A3', false).shownAgents.length, 1);
  assert.strictEqual(sessionPicker(sessions, orchs, 'M', true).hiddenCount, 0);
});

test('a worktree without orchestration is untouched by the picker', () => {
  const p = sessionPicker([sess('X'), sess('Y')], {}, 'X', false);
  assert.deepStrictEqual(p.peers.map((s) => s.sessionId), ['X', 'Y']);
  assert.strictEqual(p.canFold, false);
});

test('the composer warns only for agent sessions', () => {
  assert.deepStrictEqual(composerTarget('A1', orchs), { agentId: 'w1', masterSessionId: 'M' });
  assert.strictEqual(composerTarget('M', orchs), null);
  assert.strictEqual(composerTarget('X', orchs), null);
});

test('agent worktrees hang under the master worktree and fold by default', () => {
  const list = [wt('master-wt', [sess('M')]), wt('wt-1', [sess('A1')]), wt('wt-2', [sess('A2')]), wt('plain', [sess('X')])];
  const g = groupWorktrees(list, orchs);
  assert.deepStrictEqual(g.top.map((w) => w.name), ['master-wt', 'plain']);
  assert.deepStrictEqual(g.summary('/p/master-wt'), { count: 2, needs: 1, hidden: 1 });
  assert.deepStrictEqual(g.visibleChildren('/p/master-wt').map((w) => w.name), ['wt-2']);
  assert.deepStrictEqual(g.visibleChildren('/p/master-wt').length, 1);
  assert.strictEqual(g.isAgentWorktree('/p/wt-1'), true);
  assert.strictEqual(g.masterPathOf('/p/wt-1'), '/p/master-wt');
});

test('expanding shows every agent worktree', () => {
  const list = [wt('master-wt', [sess('M')]), wt('wt-1', [sess('A1')]), wt('wt-2', [sess('A2')])];
  const g = groupWorktrees(list, orchs, new Set(['/p/master-wt']));
  assert.deepStrictEqual(g.visibleChildren('/p/master-wt').map((w) => w.name), ['wt-1', 'wt-2']);
  assert.strictEqual(g.summary('/p/master-wt').hidden, 0);
});

test('an agent worktree whose master is not on the board stays a top-level worktree', () => {
  const g = groupWorktrees([wt('wt-1', [sess('A1')])], orchs);
  assert.deepStrictEqual(g.top.map((w) => w.name), ['wt-1']);
});

test('an agent running in the master worktree is not a separate worktree', () => {
  const g = groupWorktrees([wt('master-wt', [sess('M'), sess('A3')])], orchs);
  assert.strictEqual(g.top.length, 1);
  assert.strictEqual(g.summary('/p/master-wt').count, 0);
});

test('a master that is not live is not the default: the fallback keeps a live session', () => {
  assert.strictEqual(defaultSessionId([sess('M', { live: false }), sess('A3')], orchs, 'A3'), 'A3');
  assert.strictEqual(defaultSessionId([sess('M', { live: false })], orchs, 'M'), 'M');
});
