// The maintainer's cockpit publishes the matrix learning (edits, ratings) by itself: once the matrix has been quiet
// for a while, it commits the two data files on top of the remote branch and pushes. The commit is built in a
// temporary index, so it never takes along other local changes or unpushed commits, and never touches the work
// in progress of the checkout.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ROOT, MATRIX_MAINTAINER } = require('../config');
const { run } = require('../io/exec');
const { readJson } = require('../io/store');
const core = require('../core/matrix-publish');
const { combineRatings } = require('../core/matrix');
const { SHARED_EDITS_FILE, SHARED_RATINGS_FILE, editsText, ratingsText } = require('./matrix');
const { pushEvent } = require('./events');

async function gitIn(root, args, { input, env } = {}) {
  const result = await run('git', ['-C', root, ...args], input, env);
  if (!result.ok) throw new Error(`git ${args[0]}: ${result.stderr.trim().split('\n').pop()}`);
  return result.stdout.trim();
}

async function remoteJson(root, ref, file, fallback) {
  const result = await run('git', ['-C', root, 'show', `${ref}:${file}`]);
  if (!result.ok) return fallback;
  try {
    const value = JSON.parse(result.stdout);
    return value && typeof value === 'object' && Array.isArray(value) === Array.isArray(fallback) ? value : fallback;
  } catch {
    return fallback;
  }
}

async function operationInProgress(root) {
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply']) {
    const result = await run('git', ['-C', root, 'rev-parse', '--path-format=absolute', '--git-path', marker]);
    if (result.ok && fs.existsSync(result.stdout.trim())) return true;
  }
  return false;
}

// One publication: returns { published: false } when the remote already has everything.
async function publishMatrix({ root = ROOT, branch = 'main', editsFile = SHARED_EDITS_FILE, ratingsFile = SHARED_RATINGS_FILE } = {}) {
  const rel = (file) => path.relative(root, file);
  await gitIn(root, ['fetch', '-q', 'origin', branch]);
  const base = await gitIn(root, ['rev-parse', `origin/${branch}`]);
  const side = async (ref) => ({ edits: await remoteJson(root, ref, rel(editsFile), {}), ratings: await remoteJson(root, ref, rel(ratingsFile), []) });
  const remote = await side(base);
  const ancestor = await side('HEAD');
  const localEdits = readJson(editsFile);
  const localRatings = readJson(ratingsFile);
  const local = {
    edits: localEdits && typeof localEdits === 'object' && !Array.isArray(localEdits) ? localEdits : ancestor.edits,
    ratings: Array.isArray(localRatings) ? localRatings : ancestor.ratings,
  };
  const { edits, ratings, added, categories } = core.mergeForPublish({ ancestor, local, remote });
  if (!added.length && !categories.length) return { published: false };
  const texts = { [rel(editsFile)]: editsText(edits), [rel(ratingsFile)]: ratingsText(combineRatings(ratings, [])) };

  const index = path.join(os.tmpdir(), `cockpit-matrix-index-${process.pid}-${Date.now()}`);
  const env = { GIT_INDEX_FILE: index };
  let commit;
  const message = core.commitMessage({ ratings: added, categories });
  try {
    await gitIn(root, ['read-tree', base], { env });
    for (const [file, text] of Object.entries(texts)) {
      const blob = await gitIn(root, ['hash-object', '-w', '--stdin'], { input: text });
      await gitIn(root, ['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`], { env });
    }
    const tree = await gitIn(root, ['write-tree'], { env });
    commit = await gitIn(root, ['commit-tree', tree, '-p', base, '-m', message]);
  } finally {
    fs.rmSync(index, { force: true });
  }
  await gitIn(root, ['push', '-q', 'origin', `${commit}:refs/heads/${branch}`]);

  // The checkout follows when it sat exactly on the published base with no merge, rebase, cherry-pick or revert in
  // progress, and its data files hold what was published; otherwise its owner merges as usual.
  const head = await run('git', ['-C', root, 'symbolic-ref', '-q', 'HEAD']);
  const headSha = await run('git', ['-C', root, 'rev-parse', 'HEAD']);
  const synced = head.stdout.trim() === `refs/heads/${branch}` && headSha.stdout.trim() === base
    && !(await operationInProgress(root))
    && Object.entries(texts).every(([file, text]) => fs.existsSync(path.join(root, file)) && fs.readFileSync(path.join(root, file), 'utf8') === text);
  if (synced) {
    await gitIn(root, ['update-ref', `refs/heads/${branch}`, commit, base]);
    await gitIn(root, ['reset', '-q', '--', ...Object.keys(texts)]);
  }
  return { published: true, commit, message, synced };
}

function lastWriteAt(files) {
  return Math.max(0, ...files.map((f) => fs.statSync(f, { throwIfNoEntry: false })?.mtimeMs || 0));
}

// Decides on every tick whether to publish: when the matrix changed since the last publication (or at startup)
// and has been quiet long enough, with a retry delay after a failure and one alert after a run of failures.
function createPublishScheduler({ enabled, files, publish, notify, log = console }) {
  const state = { running: false, handledAt: 0, lastFailureAt: 0, failures: 0 };
  return async function publishIfDue({ now = Date.now() } = {}) {
    if (!enabled || state.running) return;
    const writtenAt = lastWriteAt(files);
    if (writtenAt <= state.handledAt) return;
    if (!core.publishDue({ now, lastWriteAt: state.handledAt ? writtenAt : now - core.QUIET_MS, lastFailureAt: state.lastFailureAt })) return;
    state.running = true;
    try {
      const result = await publish();
      state.handledAt = writtenAt;
      state.failures = 0;
      state.lastFailureAt = 0;
      if (result.published) log.log(`matrix published: ${result.message} (${result.commit.slice(0, 7)})${result.synced ? '' : ', local branch left as is'}`);
    } catch (error) {
      state.failures += 1;
      state.lastFailureAt = now;
      log.error('matrix publish failed', error.message);
      if (state.failures === core.ALERT_AFTER_FAILURES) notify({ type: 'matrix_publish_failed', worktree: 'cockpit', message: `La matrice n’arrive pas à être publiée : ${error.message}` });
    } finally {
      state.running = false;
    }
  };
}

async function defaultBranch() {
  const result = await run('git', ['-C', ROOT, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']);
  return result.ok && result.stdout.trim() ? result.stdout.trim().replace(/^origin\//, '') : 'main';
}

const publishMatrixIfDue = createPublishScheduler({
  enabled: MATRIX_MAINTAINER,
  files: [SHARED_EDITS_FILE, SHARED_RATINGS_FILE],
  publish: async () => publishMatrix({ branch: await defaultBranch() }),
  notify: pushEvent,
});

module.exports = { publishMatrix, publishMatrixIfDue, createPublishScheduler };
