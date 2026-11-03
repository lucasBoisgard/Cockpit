const test = require('node:test');
const assert = require('node:assert');
const { validSha, parseWorktreeList, parseStatus, parseNumstat, describeWorktree, repoLabel, rangeSpec, baseRefs, parseChanges, parseCommitLog } = require('../server/core/git');

const SHA = 'a'.repeat(40);

test('parseWorktreeList reads branches, detached heads and claude locks, and drops prunable entries', () => {
  const out = [
    `worktree /repo\nHEAD ${SHA}\nbranch refs/heads/master`,
    `worktree /repo/.claude/worktrees/one\nHEAD ${SHA}\nbranch refs/heads/feat/one\nlocked claude session abc (pid 42 start 777)`,
    `worktree /repo/.claude/worktrees/two\nHEAD ${SHA}\ndetached\nlocked by hand`,
    `worktree /repo/.claude/worktrees/gone\nHEAD ${SHA}\nprunable gitdir file points to non-existent location`,
    '',
  ].join('\n\n');
  assert.deepStrictEqual(parseWorktreeList(out), [
    { path: '/repo', head: SHA, branch: 'master' },
    { path: '/repo/.claude/worktrees/one', head: SHA, branch: 'feat/one', claudeLock: { pid: 42, start: '777' } },
    { path: '/repo/.claude/worktrees/two', head: SHA, detached: true, locked: true },
  ]);
  assert.deepStrictEqual(parseWorktreeList(null), []);
});

test('parseStatus reads ahead/behind, upstream and every entry kind', () => {
  const out = [
    '# branch.oid abc',
    '# branch.head feat',
    '# branch.upstream origin/feat',
    '# branch.ab +2 -3',
    '1 .M N... 100644 100644 100644 h1 h2 src/a b.js',
    '2 R. N... 100644 100644 100644 h1 h2 R100 new name.js\told.js',
    'u UU N... 100644 100644 100644 100644 h1 h2 h3 conflict.js',
    '? new file.txt',
  ].join('\n');
  assert.deepStrictEqual(parseStatus(out), {
    files: [
      { code: '.M', path: 'src/a b.js' },
      { code: 'R.', path: 'new name.js' },
      { code: 'UU', path: 'conflict.js' },
      { code: '??', path: 'new file.txt' },
    ],
    ahead: 2,
    behind: 3,
    upstream: 'origin/feat',
  });
  assert.deepStrictEqual(parseStatus(null), { files: [], ahead: 0, behind: 0, upstream: null });
});

test('parseNumstat maps paths to counts, binary files to zero', () => {
  assert.deepStrictEqual(parseNumstat('3\t1\ta.js\n-\t-\timg.png\n\n'), { 'a.js': { added: 3, deleted: 1 }, 'img.png': { added: 0, deleted: 0 } });
});

test('describeWorktree keeps unstaged files with their stats and counts staged ones', () => {
  const status = ['# branch.ab +1 -0', '1 M. N... 1 1 1 h h staged.js', '1 .M N... 1 1 1 h h edited.js', '1 MM N... 1 1 1 h h both.js', '? new.js'].join('\n');
  const wt = { path: '/repo/wt', branch: 'feat', head: SHA };
  const result = describeWorktree(wt, 'wt', { status, numstat: '4\t2\tedited.js\n1\t0\tboth.js', lastCommit: 'Subject\x00100\n' }, null);
  assert.deepStrictEqual(result.files, [
    { code: '.M', path: 'edited.js', added: 4, deleted: 2 },
    { code: 'MM', path: 'both.js', added: 1, deleted: 0 },
    { code: '??', path: 'new.js' },
  ]);
  assert.strictEqual(result.staged, 2);
  assert.strictEqual(result.added, 5);
  assert.strictEqual(result.deleted, 2);
  assert.strictEqual(result.head, 'aaaaaaa');
  assert.deepStrictEqual(result.lastCommit, { subject: 'Subject', at: 100000 });
  assert.strictEqual(describeWorktree(wt, 'wt', { status: '', numstat: '', lastCommit: null }, null).lastCommit, null);
});

test('repoLabel reads owner/name from ssh and https remotes, else the folder name', () => {
  assert.strictEqual(repoLabel('git@github.com:acme/app.git\n', '/x/app'), 'acme/app');
  assert.strictEqual(repoLabel('https://github.com/acme/app', '/x/app'), 'acme/app');
  assert.strictEqual(repoLabel(null, '/x/folder'), 'folder');
});

test('rangeSpec turns a range into git args or a base to resolve', () => {
  assert.deepStrictEqual(rangeSpec(SHA), { args: [SHA] });
  assert.deepStrictEqual(rangeSpec('branch'), { base: 'branch' });
  assert.deepStrictEqual(rangeSpec('pr'), { base: 'pr' });
  assert.deepStrictEqual(rangeSpec('work'), { args: [] });
  assert.deepStrictEqual(rangeSpec(`commit:${SHA}`), { args: [`${SHA}^!`] });
  assert.strictEqual(rangeSpec('commit:abc'), null);
  assert.strictEqual(rangeSpec('HEAD~1'), null);
  assert.strictEqual(rangeSpec(''), null);
  assert.strictEqual(rangeSpec(undefined), null);
});

test('baseRefs prefers the PR base, then the configured base, remote before local', () => {
  assert.deepStrictEqual(baseRefs('develop', 'master'), { fetch: 'develop', refs: ['origin/develop', 'develop', 'origin/master', 'master'] });
  assert.deepStrictEqual(baseRefs(undefined, 'master'), { fetch: 'master', refs: ['origin/master', 'master'] });
  assert.deepStrictEqual(baseRefs('master', 'master'), { fetch: 'master', refs: ['origin/master', 'master'] });
});

test('validSha accepts only full lowercase hex shas', () => {
  assert.ok(validSha(SHA));
  assert.ok(!validSha(SHA.toUpperCase()));
  assert.ok(!validSha('abc'));
  assert.ok(!validSha(null));
});

test('parseChanges joins name-status with numstat and appends untracked files', () => {
  const files = parseChanges('2\t1\ta.js\n5\t0\tnew.js', 'M\ta.js\nR100\told.js\tnew.js\n', 'u.txt\n');
  assert.deepStrictEqual(files, [
    { code: 'M', path: 'a.js', added: 2, deleted: 1 },
    { code: 'R', path: 'new.js', added: 5, deleted: 0 },
    { code: '??', path: 'u.txt' },
  ]);
  assert.deepStrictEqual(parseChanges('', null, ''), []);
});

test('parseCommitLog splits unit-separated fields', () => {
  assert.deepStrictEqual(parseCommitLog(`${SHA}\x1f10\x1fFirst\n${SHA}\x1f20\x1fSecond\n`), [
    { sha: SHA, at: 10000, subject: 'First' },
    { sha: SHA, at: 20000, subject: 'Second' },
  ]);
});
