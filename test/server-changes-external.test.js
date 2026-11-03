const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-ext-')));
const repo = path.join(root, 'repo');
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' }).toString();
fs.mkdirSync(repo);
git('init', '-q', '-b', 'main');
git('config', 'user.email', 'test@example.com');
git('config', 'user.name', 'Test');
fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
git('add', '.');
git('commit', '-qm', 'base');
git('update-ref', 'refs/remotes/origin/main', 'HEAD');
git('checkout', '-qb', 'feat');
fs.writeFileSync(path.join(repo, 'b.txt'), 'two\n');
git('add', '.');
git('commit', '-qm', 'feature');
fs.writeFileSync(path.join(repo, 'a.txt'), 'one\nmore\n');
fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n');
fs.writeFileSync(path.join(root, 'secret.txt'), 'secret\n');

const snapshotModule = require('../server/features/snapshot');
snapshotModule.snapshot = async () => ({ worktrees: [{ name: 'card', sessions: [{ externalRepos: [{ path: repo, name: 'me/repo', branch: 'feat' }] }] }] });
const { changesSince, ticketCommits, diff } = require('../server/features/changes');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('an external repo lists its uncommitted changes, untracked files included', async () => {
  const files = await changesSince(repo, 'work');
  assert.deepStrictEqual(files.map((f) => `${f.code} ${f.path}`).sort(), ['?? new.txt', 'M a.txt']);
});

test('an external repo diffs its ticket against its default branch', async () => {
  const commits = await ticketCommits(repo);
  assert.deepStrictEqual([commits.base, commits.commits.map((c) => c.subject), commits.pr], ['main', ['feature'], null]);
  const files = await changesSince(repo, 'branch');
  assert.deepStrictEqual(files.map((f) => f.path).sort(), ['a.txt', 'b.txt', 'new.txt']);
  assert.match(await diff(repo, 'a.txt', ''), /\+more/);
  assert.match(await diff(repo, 'new.txt', 'work'), /\+new/);
});

test('paths outside the listed repos or outside the repo are refused', async () => {
  assert.strictEqual(await changesSince(root, 'work'), null);
  assert.strictEqual(await changesSince(`${repo}/`, 'work'), null);
  assert.strictEqual(await diff(repo, '../secret.txt', ''), null);
  assert.strictEqual(await diff(repo, path.join(root, 'secret.txt'), ''), null);
  assert.strictEqual(await diff('/etc', 'passwd', ''), null);
});

test('externalRepos finds the repos of edited folders and actions, without the card repo', async () => {
  const { externalRepos } = require('../server/features/worktrees');
  const session = { cwd: root, editedDirs: [path.join(repo, 'gone', 'deeper'), root], actions: [{ tool: 'Edit', detail: path.join(repo, 'a.txt') }, { tool: 'Bash', detail: 'ls' }] };
  assert.deepStrictEqual((await externalRepos(session, '/elsewhere')).map((r) => [r.path, r.branch]), [[repo, 'feat']]);
  assert.deepStrictEqual(await externalRepos(session, repo), []);
});
