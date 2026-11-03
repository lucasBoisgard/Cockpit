const test = require('node:test');
const assert = require('node:assert');
const { STALE_MS, withClaudeStatus, effectiveStatus, turnStatus, paneOf, ownerOf, shouldQueue, sessionEvent, validName, validPrRef, tmuxSessionName, reviewPrompt } = require('../server/core/sessions');

function panesWith(entries, { bySession = [], claudeStatus = [] } = {}) {
  const panes = new Map(entries);
  return Object.assign(panes, { bySession: new Map(bySession), claudeStatus: new Map(claudeStatus) });
}

test('withClaudeStatus turns a working session idle when Claude reports idle after the last hook', () => {
  const session = { sessionId: 's', status: 'working', updatedAt: 5000, statusSince: 2000, workedMs: 100 };
  const panes = panesWith([], { claudeStatus: [['s', { status: 'idle', at: 9000 }]] });
  assert.deepStrictEqual(withClaudeStatus(session, panes), { ...session, status: 'idle', statusSince: 9000, workedMs: 3100 });
});

test('withClaudeStatus keeps the session when Claude reports nothing newer', () => {
  const session = { sessionId: 's', status: 'working', updatedAt: 5000, statusSince: 2000 };
  assert.strictEqual(withClaudeStatus(session, panesWith([], { claudeStatus: [['s', { status: 'idle', at: 5000 }]] })), session);
  assert.strictEqual(withClaudeStatus(session, panesWith([], { claudeStatus: [['s', { status: 'busy', at: 9000 }]] })), session);
  assert.strictEqual(withClaudeStatus({ ...session, status: 'done' }, panesWith([], { claudeStatus: [['s', { status: 'idle', at: 9000 }]] })).status, 'done');
  assert.strictEqual(withClaudeStatus(session, new Map()), session);
});

test('paneOf trusts the recorded pane unless it was recreated, then falls back to the Claude registry', () => {
  const panes = panesWith([['%1', { session: 'cw', created: 10000 }]], { bySession: [['s', '%7']] });
  assert.strictEqual(paneOf({ sessionId: 's', tmuxPane: '%1', tmuxPaneSince: 8000 }, panes), '%1');
  assert.strictEqual(paneOf({ sessionId: 's', tmuxPane: '%1', tmuxPaneSince: 1000 }, panes), '%7');
  assert.strictEqual(paneOf({ sessionId: 's', tmuxPane: '%1', status: 'ended' }, panes), '%7');
  assert.strictEqual(paneOf({ sessionId: 'x', tmuxPane: '%9' }, panes), null);
  assert.strictEqual(paneOf(null, panes), null);
});

test('ownerOf picks the deepest worktree containing the cwd', () => {
  const worktrees = [{ path: '/repo' }, { path: '/repo/.claude/worktrees/a' }];
  assert.strictEqual(ownerOf('/repo/.claude/worktrees/a/src', worktrees).path, '/repo/.claude/worktrees/a');
  assert.strictEqual(ownerOf('/repo/src', worktrees).path, '/repo');
  assert.strictEqual(ownerOf('/repository', worktrees), undefined);
});

test('shouldQueue queues for busy sessions that are not stale', () => {
  const now = 100000;
  assert.ok(shouldQueue({ status: 'working', updatedAt: now - 10 }, false, now, 1000));
  assert.ok(!shouldQueue({ status: 'working', updatedAt: now - 5000 }, false, now, 1000));
  assert.ok(!shouldQueue({ status: 'needs_input', updatedAt: now }, false, now, 1000));
  assert.ok(shouldQueue({ status: 'needs_input', updatedAt: now }, true, now, 1000));
  assert.ok(!shouldQueue({ status: 'done', updatedAt: now }, true, now, 1000));
});

test('sessionEvent reports waits and finished turns, only on a change', () => {
  assert.strictEqual(sessionEvent(undefined, { status: 'needs_input' }), null);
  assert.strictEqual(sessionEvent('needs_input', { status: 'needs_input' }), null);
  assert.deepStrictEqual(sessionEvent('working', { status: 'needs_input', question: {}, message: 'Q?' }), { type: 'question', message: 'Q?' });
  assert.deepStrictEqual(sessionEvent('working', { status: 'needs_input', permission: true }), { type: 'permission', message: 'Claude attend ta réponse' });
  assert.deepStrictEqual(sessionEvent('working', { status: 'needs_input' }), { type: 'needs_input', message: 'Claude attend ta réponse' });
  assert.deepStrictEqual(sessionEvent('working', { status: 'done', lastAssistant: 'Fini' }), { type: 'done', message: 'Fini' });
  assert.deepStrictEqual(sessionEvent('working', { status: 'done' }), { type: 'done', message: 'Tour terminé' });
  assert.strictEqual(sessionEvent('needs_input', { status: 'done' }), null);
  assert.strictEqual(sessionEvent('done', { status: 'working' }), null);
});

test('validName, validPrRef and tmuxSessionName', () => {
  assert.ok(validName('feat-1.a_b'));
  assert.ok(!validName('-x'));
  assert.ok(!validName('a/b'));
  assert.ok(!validName('a'.repeat(62)));
  assert.ok(validPrRef('#12'));
  assert.ok(validPrRef('12'));
  assert.ok(validPrRef('https://github.com/acme/app/pull/12/files'));
  assert.ok(!validPrRef('https://evil.example/acme/app/pull/12'));
  assert.ok(!validPrRef('12; rm -rf'));
  assert.strictEqual(tmuxSessionName('wt', 36 ** 4 + 35), 'cw-wt-000z');
});

test('reviewPrompt appends the extra instructions only when present', () => {
  assert.strictEqual(reviewPrompt('#12', '  '), 'Review the pull request #12.');
  assert.strictEqual(reviewPrompt('#12', ' focus on tests '), 'Review the pull request #12.\n\nfocus on tests');
});

test('effectiveStatus turns a working session idle once its last hook event is stale', () => {
  const panes = panesWith([]);
  const session = { sessionId: 's', status: 'working', updatedAt: 1000, statusSince: 500 };
  assert.deepStrictEqual(effectiveStatus(session, panes, 1000 + STALE_MS - 1), session);
  assert.deepStrictEqual(effectiveStatus(session, panes, 1000 + STALE_MS), { ...session, status: 'idle', statusSince: 1000, stale: true });
  assert.strictEqual(effectiveStatus({ ...session, status: 'done' }, panes, 1000 + STALE_MS).status, 'done');
});

test('sessionEvent still reports done after a stale turn when callers pass the live status', () => {
  const panes = panesWith([]);
  const stale = effectiveStatus({ sessionId: 's', status: 'working', updatedAt: 0 }, panes, STALE_MS);
  assert.strictEqual(stale.stale, true);
  assert.strictEqual(sessionEvent('working', { ...stale, status: 'done' })?.type, 'done');
});

test('turnStatus keeps a turn working while background agents run, so done fires once they finish', () => {
  assert.strictEqual(turnStatus({ status: 'done', agentsRunning: 2 }), 'working');
  assert.strictEqual(turnStatus({ status: 'idle', agentsRunning: 1 }), 'working');
  assert.strictEqual(turnStatus({ status: 'needs_input', agentsRunning: 1 }), 'needs_input');
  assert.strictEqual(turnStatus({ status: 'done', agentsRunning: 0 }), 'done');
  assert.strictEqual(turnStatus({ status: 'idle', stale: true }), 'working');
  assert.strictEqual(sessionEvent('working', { status: turnStatus({ status: 'done', agentsRunning: 0 }) })?.type, 'done');
  assert.strictEqual(sessionEvent('working', { status: turnStatus({ status: 'done', agentsRunning: 1 }) }), null);
});
