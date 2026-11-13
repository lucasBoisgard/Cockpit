const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { buildFileTree, fileTreeRows, ancestorDirs, searchFiles, statusMark, humanSize } = require('../web/js/file-tree.js');
const { insideRoot, parseFileList, fileContent } = require('../server/core/files');

test('the tree lists folders first, then files, and only opens the folders asked for', () => {
  const tree = buildFileTree(['b.txt', 'src/z.js', 'src/lib/a.js', 'a.txt', 'docs/x.md']);
  const names = (open) => fileTreeRows(tree, new Set(open)).map((r) => `${'  '.repeat(r.depth)}${r.kind === 'dir' ? `${r.name}/` : r.name}`);
  assert.deepStrictEqual(names([]), ['docs/', 'src/', 'a.txt', 'b.txt']);
  assert.deepStrictEqual(names(['src', 'src/lib']), ['docs/', 'src/', '  lib/', '    a.js', '  z.js', 'a.txt', 'b.txt']);
  assert.deepStrictEqual(names(['src/lib']), ['docs/', 'src/', 'a.txt', 'b.txt']);
});

test('a file opens every folder above it', () => {
  assert.deepStrictEqual(ancestorDirs('a/b/c.js'), ['a', 'a/b']);
  assert.deepStrictEqual(ancestorDirs('top.js'), []);
});

test('search needs every word and ranks file name matches before folder matches', () => {
  const files = ['server/http.js', 'web/js/panel-files.js', 'files/readme.md', 'web/css/files.css', 'server/features/files.js'];
  assert.deepStrictEqual(searchFiles(files, 'files'), ['web/css/files.css', 'server/features/files.js', 'web/js/panel-files.js', 'files/readme.md']);
  assert.deepStrictEqual(searchFiles(files, 'web files'), ['web/css/files.css', 'web/js/panel-files.js']);
  assert.deepStrictEqual(searchFiles(files, '  '), []);
  assert.strictEqual(searchFiles(files, 's', 2).length, 2);
});

test('the status mark prefers the unstaged side and shows untracked files as U', () => {
  assert.deepStrictEqual(['.M', 'M.', 'A.', 'MD', '??', 'UU'].map(statusMark), ['M', 'M', 'A', 'D', 'U', 'U']);
});

test('sizes read in French units', () => {
  assert.deepStrictEqual([humanSize(12), humanSize(2048), humanSize(204800), humanSize(3 * 1024 * 1024)], ['12 o', '2,0 Ko', '200 Ko', '3,0 Mo']);
});

test('only relative paths inside the root are accepted', () => {
  assert.strictEqual(insideRoot('/repo', 'a/b.js'), '/repo/a/b.js');
  for (const bad of ['../x', '/etc/passwd', 'a/../../x', '', 'a\0b', '.']) assert.strictEqual(insideRoot('/repo', bad), null, bad);
});

test('the file list is sorted, deduplicated and capped', () => {
  assert.deepStrictEqual(parseFileList('b\0a\0b\0'), { files: ['a', 'b'], truncated: false });
  assert.deepStrictEqual(parseFileList('c\0b\0a\0', 2), { files: ['a', 'b'], truncated: true });
});

test('binary files have no content and large text is cut', () => {
  assert.deepStrictEqual(fileContent(Buffer.from([1, 0, 2]), 3), { binary: true, size: 3 });
  assert.deepStrictEqual(fileContent(Buffer.from('héllo'), 10, 2), { binary: false, size: 10, truncated: true, content: 'h' });
  assert.deepStrictEqual(fileContent(Buffer.from('ok\n'), 3), { binary: false, size: 3, truncated: false, content: 'ok\n' });
});

test('the server lists and reads tracked and untracked files but never ignored ones or files outside', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-files-')));
  const repo = path.join(root, 'repo');
  const run = (...args) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  run('init', '-q', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'src/a.js'), 'one\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), '.env\n');
  run('add', '.');
  run('-c', 'user.email=t@example.com', '-c', 'user.name=T', 'commit', '-qm', 'base');
  fs.writeFileSync(path.join(repo, 'new.md'), '# New\n');
  fs.writeFileSync(path.join(repo, '.env'), 'SECRET=1\n');
  fs.writeFileSync(path.join(root, 'outside.txt'), 'no\n');
  fs.symlinkSync(path.join(root, 'outside.txt'), path.join(repo, 'link.txt'));
  fs.symlinkSync('.env', path.join(repo, 'env-link'));
  fs.symlinkSync('src/a.js', path.join(repo, 'a-link'));

  const changes = require('../server/features/changes');
  const original = changes.changesTarget;
  changes.changesTarget = async (p) => (p === repo ? { path: repo } : null);
  delete require.cache[require.resolve('../server/features/files')];
  const { listFiles, readFile } = require('../server/features/files');
  try {
    assert.deepStrictEqual((await listFiles(repo)).files, ['.gitignore', 'a-link', 'env-link', 'link.txt', 'new.md', 'src/a.js']);
    assert.strictEqual(await readFile(repo, 'env-link'), null);
    assert.strictEqual((await readFile(repo, 'a-link')).content, 'one\n');
    assert.strictEqual(await listFiles(root), null);
    assert.strictEqual((await readFile(repo, 'src/a.js')).content, 'one\n');
    assert.strictEqual((await readFile(repo, 'new.md')).content, '# New\n');
    assert.strictEqual(await readFile(repo, '.env'), null);
    assert.strictEqual(await readFile(repo, '../outside.txt'), null);
    assert.strictEqual(await readFile(repo, 'link.txt'), null);
    fs.rmSync(path.join(repo, 'src/a.js'));
    assert.deepStrictEqual(await readFile(repo, 'src/a.js'), { path: 'src/a.js', missing: true });
  } finally {
    changes.changesTarget = original;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
