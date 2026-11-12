const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-publish-home-'));
process.env.HOME = home;
fs.mkdirSync(path.join(home, '.claude'), { recursive: true });

const core = require('../server/core/matrix-publish');
const { publishMatrix, createPublishScheduler } = require('../server/features/matrix-publish');

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim();
const rating = (at, category = 'review') => ({ at, category, provider: 'claude', model: 'sonnet', effort: 'medium', score: 4, agent: `w${at}`, master: 'm' });
const ratingsText = (list) => `[\n${list.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`;

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-publish-'));
  const remote = path.join(dir, 'remote.git');
  const repo = path.join(dir, 'repo');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote]);
  execFileSync('git', ['clone', '-q', remote, repo]);
  git(repo, 'config', 'user.name', 't');
  git(repo, 'config', 'user.email', 't@t');
  fs.mkdirSync(path.join(repo, 'server', 'data'), { recursive: true });
  const files = { editsFile: path.join(repo, 'server', 'data', 'model-matrix-edits.json'), ratingsFile: path.join(repo, 'server', 'data', 'model-ratings.json') };
  fs.writeFileSync(files.editsFile, '{}\n');
  fs.writeFileSync(files.ratingsFile, ratingsText([rating(1)]));
  fs.writeFileSync(path.join(repo, 'README.md'), 'x\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'init');
  git(repo, 'push', '-q', 'origin', 'main');
  return { repo, remote, ...files };
}

test('publishDue waits for a quiet matrix and backs off after a failure', () => {
  assert.strictEqual(core.publishDue({ now: 1000, lastWriteAt: 0 }), false);
  assert.strictEqual(core.publishDue({ now: core.QUIET_MS + 10, lastWriteAt: 20 }), false);
  assert.strictEqual(core.publishDue({ now: core.QUIET_MS + 10, lastWriteAt: 10 }), true);
  assert.strictEqual(core.publishDue({ now: core.QUIET_MS + 10, lastWriteAt: 10, lastFailureAt: core.QUIET_MS }), false);
});

test('commitMessage summarises the new ratings and the edited categories', () => {
  assert.strictEqual(core.commitMessage({ ratings: [rating(1, 'review'), rating(2, 'debug'), rating(3, 'review')], categories: ['explore'] }), 'chore(matrix): publish 3 ratings (debug, review) and 1 category edit (explore)');
  assert.strictEqual(core.commitMessage({ ratings: [rating(1)] }), 'chore(matrix): publish 1 rating (review)');
  assert.deepStrictEqual(core.changedCategories({ categories: { a: { x: 1 } } }, { categories: { a: { x: 2 }, b: {} } }), ['a', 'b']);
  assert.deepStrictEqual(core.newRatings([rating(1)], [rating(1), rating(2)]).map((r) => r.at), [2]);
});

test('publishMatrix pushes only the matrix files, keeps other work local and moves the checkout along', async () => {
  const { repo, remote, editsFile, ratingsFile } = setup();
  fs.writeFileSync(ratingsFile, ratingsText([rating(1), rating(2, 'debug')]));
  fs.writeFileSync(editsFile, `${JSON.stringify({ categories: { explore: { id: 'explore', label: 'E', picks: [] } } }, null, 2)}\n`);
  fs.writeFileSync(path.join(repo, 'README.md'), 'work in progress\n');
  const result = await publishMatrix({ root: repo, branch: 'main', editsFile, ratingsFile });
  assert.strictEqual(result.published, true);
  assert.strictEqual(result.synced, true);
  assert.strictEqual(result.message, 'chore(matrix): publish 1 rating (debug) and 1 category edit (explore)');
  assert.deepStrictEqual(git(remote, 'show', '--name-only', '--format=', 'main').split('\n').sort(), ['server/data/model-matrix-edits.json', 'server/data/model-ratings.json']);
  assert.strictEqual(git(remote, 'show', 'main:README.md'), 'x');
  assert.strictEqual(git(repo, 'rev-parse', 'HEAD'), git(remote, 'rev-parse', 'main'));
  assert.strictEqual(git(repo, 'status', '--porcelain'), 'M README.md');
  assert.deepStrictEqual(await publishMatrix({ root: repo, branch: 'main', editsFile, ratingsFile }), { published: false });
});

function pushFromElsewhere(repo, remote, edits, ratings) {
  const other = path.join(path.dirname(repo), `other-${Date.now()}`);
  execFileSync('git', ['clone', '-q', remote, other]);
  git(other, 'config', 'user.name', 't');
  git(other, 'config', 'user.email', 't@t');
  if (edits) fs.writeFileSync(path.join(other, 'server', 'data', 'model-matrix-edits.json'), `${JSON.stringify(edits, null, 2)}\n`);
  if (ratings) fs.writeFileSync(path.join(other, 'server', 'data', 'model-ratings.json'), ratingsText(ratings));
  git(other, 'commit', '-qam', 'elsewhere');
  git(other, 'push', '-q', 'origin', 'main');
}

test('a checkout behind the remote publishes only its own changes and never reverts the remote', async () => {
  const { repo, remote, editsFile, ratingsFile } = setup();
  pushFromElsewhere(repo, remote, { categories: { review: { id: 'review', label: 'R', picks: [] } } }, [rating(5)]);
  fs.writeFileSync(ratingsFile, ratingsText([rating(1), rating(3)]));
  const result = await publishMatrix({ root: repo, branch: 'main', editsFile, ratingsFile });
  assert.strictEqual(result.published, true);
  assert.strictEqual(result.synced, false);
  assert.strictEqual(result.message, 'chore(matrix): publish 1 rating (review)');
  assert.deepStrictEqual(JSON.parse(git(remote, 'show', 'main:server/data/model-ratings.json')).map((r) => r.at), [3, 5], 'the rating removed on the remote stays removed');
  assert.deepStrictEqual(Object.keys(JSON.parse(git(remote, 'show', 'main:server/data/model-matrix-edits.json')).categories), ['review']);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(ratingsFile, 'utf8')).map((r) => r.at), [1, 3], 'the local file is not rewritten');
  assert.deepStrictEqual((await publishMatrix({ root: repo, branch: 'main', editsFile, ratingsFile })).published, false);
});

test('a checkout in the middle of a merge is published but not moved', async () => {
  const { repo, editsFile, ratingsFile } = setup();
  fs.writeFileSync(ratingsFile, ratingsText([rating(1), rating(2)]));
  const head = git(repo, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repo, '.git', 'MERGE_HEAD'), `${head}\n`);
  const result = await publishMatrix({ root: repo, branch: 'main', editsFile, ratingsFile });
  assert.deepStrictEqual([result.published, result.synced], [true, false]);
  assert.strictEqual(git(repo, 'rev-parse', 'HEAD'), head);
});

test('the scheduler publishes at startup, waits for quiet, retries after a delay and alerts once', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-scheduler-'));
  const file = path.join(dir, 'ratings.json');
  fs.writeFileSync(file, '[]');
  const writtenAt = fs.statSync(file).mtimeMs;
  const calls = [];
  const events = [];
  let fail = false;
  const silent = { log() {}, error() {} };
  const tick = createPublishScheduler({ enabled: true, files: [file], notify: (e) => events.push(e), log: silent, publish: async () => {
    calls.push(1);
    if (fail) throw new Error('offline');
    return { published: false };
  } });
  await tick({ now: writtenAt + 1 });
  assert.strictEqual(calls.length, 1, 'publishes at startup');
  await tick({ now: writtenAt + 2 });
  assert.strictEqual(calls.length, 1, 'nothing changed since');
  fs.utimesSync(file, new Date(), new Date(writtenAt + 10000));
  const later = fs.statSync(file).mtimeMs;
  await tick({ now: later + 1000 });
  assert.strictEqual(calls.length, 1, 'waits for the matrix to be quiet');
  fail = true;
  let now = later + core.QUIET_MS;
  for (let i = 0; i < 4; i += 1) {
    await tick({ now });
    await tick({ now: now + 1000 });
    now += core.RETRY_MS;
  }
  assert.strictEqual(calls.length, 5, 'one attempt per retry delay');
  assert.deepStrictEqual(events.map((e) => e.type), ['matrix_publish_failed'], 'one alert after three failures');
  fail = false;
  await tick({ now });
  assert.strictEqual(calls.length, 6);
  await tick({ now: now + core.QUIET_MS });
  assert.strictEqual(calls.length, 6, 'handled after a success');
  const disabled = createPublishScheduler({ enabled: false, files: [file], notify() {}, log: silent, publish: async () => calls.push(1) });
  await disabled({ now });
  assert.strictEqual(calls.length, 6);
});
