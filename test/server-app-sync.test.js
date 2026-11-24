const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-app-sync-'));
const repo = path.join(tmp, 'repo');
const wtPath = path.join(tmp, 'wt');
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
fs.mkdirSync(repo);
git(repo, 'init', '-q', '-b', 'main');
fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored/\n');
git(repo, 'add', '.');
git(repo, 'commit', '-q', '-m', 'init');
git(repo, 'worktree', 'add', '-q', '-b', 'feat', wtPath);
process.env.REPO = repo;
const { syncFrom } = require('../server/features/app');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('syncFrom puts the main checkout on the worktree code, uncommitted and untracked files included, and stashes foreign changes', async () => {
  fs.writeFileSync(path.join(wtPath, 'a.txt'), 'two\n');
  git(wtPath, 'commit', '-q', '-am', 'two');
  fs.writeFileSync(path.join(wtPath, 'a.txt'), 'three\n');
  fs.mkdirSync(path.join(wtPath, 'new'));
  fs.writeFileSync(path.join(wtPath, 'new', 'b.txt'), 'b\n');
  fs.mkdirSync(path.join(wtPath, 'ignored'));
  fs.writeFileSync(path.join(wtPath, 'ignored', 'x'), 'x\n');
  fs.writeFileSync(path.join(repo, 'a.txt'), 'local edit\n');

  const first = await syncFrom({ path: wtPath }, null);
  assert.ok(first.ok, first.error);
  assert.match(first.stashed, /^cockpit-app-/);
  assert.strictEqual(git(repo, 'rev-parse', 'HEAD'), git(wtPath, 'rev-parse', 'HEAD'));
  assert.strictEqual(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'three\n');
  assert.strictEqual(fs.readFileSync(path.join(repo, 'new', 'b.txt'), 'utf8'), 'b\n');
  assert.ok(!fs.existsSync(path.join(repo, 'ignored')));
  assert.deepStrictEqual(first.untracked, ['new/b.txt']);

  // Next turn: the worktree commits b.txt and drops the a.txt change; the previous sync is replaced, nothing is stashed
  fs.writeFileSync(path.join(wtPath, 'a.txt'), 'two\n');
  git(wtPath, 'add', '.');
  git(wtPath, 'commit', '-q', '-m', 'b');
  const second = await syncFrom({ path: wtPath }, { sha: first.head, untracked: first.untracked });
  assert.ok(second.ok, second.error);
  assert.strictEqual(second.stashed, undefined);
  assert.strictEqual(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8'), 'two\n');
  assert.strictEqual(git(repo, 'status', '--porcelain'), '');
});
