const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-store-'));
process.env.HOME = home;
const stateDir = path.join(home, '.claude', 'worktree-state');
fs.mkdirSync(stateDir, { recursive: true });
const { readSession, readSessions, writeSessionOverride } = require('../server/io/store');

const write = (name, data) => fs.writeFileSync(path.join(stateDir, name), JSON.stringify(data));

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

test('a server override wins only while it is newer than the hook state', () => {
  const now = Date.now();
  write('a.json', { sessionId: 'a', cwd: '/w', status: 'done', updatedAt: now - 1000, task: 't' });
  writeSessionOverride('a', { status: 'working', updatedAt: now });
  assert.deepStrictEqual(readSession('a'), { sessionId: 'a', cwd: '/w', status: 'working', updatedAt: now, task: 't' });
  write('a.json', { sessionId: 'a', cwd: '/w', status: 'done', updatedAt: now + 1000, task: 't' });
  assert.strictEqual(readSession('a').status, 'done');
});

test('readSessions lists hook states only, not overrides or checkpoints', () => {
  write('b.checkpoints.json', [{ at: 1, sha: 'x' }]);
  assert.deepStrictEqual(readSessions().map((s) => s.sessionId), ['a']);
  assert.strictEqual(readSession('b.checkpoints'), null);
});
