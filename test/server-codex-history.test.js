const test = require('node:test');
const assert = require('node:assert/strict');
const { codexHistoryMeta, inRepo } = require('../server/core/codex-history');

test('extracts Codex session metadata and conversational messages', () => {
  const text = [
    { timestamp: '2026-11-01T10:00:00Z', type: 'session_meta', payload: { id: '123', cwd: '/repo/wt', git: { branch: 'feature' } } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ text: 'Fix the issue' }] } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ text: 'Done' }] } },
  ].map(JSON.stringify).join('\n');
  const meta = codexHistoryMeta(text, '/rollout.jsonl', 12345);
  assert.deepEqual([meta.sessionId, meta.provider, meta.cwd, meta.branch, meta.title, meta.messages], ['123', 'codex', '/repo/wt', 'feature', 'Fix the issue', 2]);
  assert.equal(codexHistoryMeta('{}', '/bad', 0), null);
});

test('history only accepts normalized paths in the repository', () => {
  assert.equal(inRepo('/repo/worktrees/test', '/repo'), true);
  assert.equal(inRepo('/repo/../elsewhere', '/repo'), false);
  assert.equal(inRepo('/repo-other', '/repo'), false);
  assert.equal(inRepo('repo/worktree', '/repo'), false);
});
