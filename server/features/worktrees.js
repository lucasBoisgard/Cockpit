const fs = require('node:fs');
const path = require('node:path');
const { REPO, ROOT, CONFIG, BASE_BRANCH, CLAUDE_SESSIONS_DIR } = require('../config');
const { git, tmux } = require('../io/exec');
const { processAlive } = require('../io/proc');
const { readReview, readSessions } = require('../io/store');
const { parseWorktreeList, describeWorktree, assignWorktreeNames, repoCandidates, repoLabel } = require('../core/git');
const { EDIT_TOOLS } = require('../core/transcript');

const REPO_CACHE_TTL_MS = 30000;
const RECENT_SESSION_MS = 14 * 24 * 3600 * 1000;
const repoCache = new Map();
const mainRepoCache = new Map();
const baseCache = new Map();
let worktreeNames = new Map();

async function mainRepoOf(dir) {
  const cached = mainRepoCache.get(dir);
  if (cached && (cached.repo || Date.now() - cached.at < REPO_CACHE_TTL_MS)) return cached.repo;
  let repo = null;
  if (fs.existsSync(dir)) {
    const common = ((await git(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir'])) || '').trim();
    if (path.basename(common) === '.git') repo = path.dirname(common);
  }
  mainRepoCache.set(dir, { at: Date.now(), repo });
  return repo;
}

async function knownRepos() {
  const dirs = repoCandidates({ primary: REPO, own: ROOT, extra: CONFIG.repos, sessions: readSessions(), now: Date.now(), recentMs: RECENT_SESSION_MS });
  const repos = await Promise.all(dirs.map((dir) => (dir === REPO ? REPO : mainRepoOf(dir))));
  return [...new Set(repos.filter(Boolean))];
}

async function listWorktrees() {
  const lists = await Promise.all((await knownRepos()).map(async (repo) => parseWorktreeList(await git(repo, ['worktree', 'list', '--porcelain'])).map((wt) => ({ ...wt, repo }))));
  const seen = new Set();
  const worktrees = lists.flat().filter((wt) => !seen.has(wt.path) && seen.add(wt.path) && fs.existsSync(wt.path));
  worktreeNames = assignWorktreeNames(worktrees, REPO);
  return worktrees;
}

const findWorktree = async (wtPath) => (await listWorktrees()).find((wt) => wt.path === wtPath) || null;

const worktreeName = (wtPath) => worktreeNames.get(wtPath) || (wtPath === REPO ? 'main' : path.basename(wtPath));

const isMainCheckout = (wt) => wt.path === (wt.repo || REPO);

async function defaultBranch(repoPath) {
  const head = ((await git(repoPath, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])) || '').trim();
  if (head.startsWith('origin/')) return head.slice('origin/'.length);
  for (const branch of ['main', 'master']) if (await git(repoPath, ['rev-parse', '--verify', '-q', `origin/${branch}`])) return branch;
  return BASE_BRANCH;
}

async function baseBranchOf(repo) {
  if (!repo || repo === REPO) return BASE_BRANCH;
  if (!baseCache.has(repo)) baseCache.set(repo, await defaultBranch(repo));
  return baseCache.get(repo);
}

function claudePanes(panes) {
  const bySession = new Map();
  const claudeStatus = new Map();
  let files = [];
  try {
    files = fs.readdirSync(CLAUDE_SESSIONS_DIR).filter((f) => f.endsWith('.json'));
  } catch {}
  for (const file of files) {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(CLAUDE_SESSIONS_DIR, file), 'utf8'));
      const pane = /(%\d+)$/.exec(entry.tmux || '')?.[1];
      if (!entry.sessionId || !processAlive(entry.pid)) continue;
      if (pane && panes.has(pane)) bySession.set(entry.sessionId, pane);
      claudeStatus.set(entry.sessionId, { status: entry.status, at: entry.statusUpdatedAt || 0 });
    } catch {}
  }
  return { bySession, claudeStatus };
}

async function livePanes() {
  const result = await tmux(['list-panes', '-a', '-F', '#{pane_id}\t#{session_name}\t#{pane_dead}\t#{session_created}']);
  const panes = new Map();
  if (!result.ok) return panes;
  for (const line of result.stdout.split('\n')) {
    const [id, session, dead, created] = line.split('\t');
    if (id && dead !== '1') panes.set(id, { session, created: Number(created) * 1000 });
  }
  Object.assign(panes, claudePanes(panes));
  return panes;
}

function hasTranscript(session) {
  return !!session.transcriptPath && fs.existsSync(session.transcriptPath);
}

async function repoOf(dir) {
  const cached = repoCache.get(dir);
  if (cached && Date.now() - cached.at < REPO_CACHE_TTL_MS) return cached.info;
  const top = ((await git(dir, ['rev-parse', '--show-toplevel'])) || '').trim();
  let info = null;
  if (top) {
    const [branch, remote] = await Promise.all([git(top, ['branch', '--show-current']), git(top, ['remote', 'get-url', 'origin'])]);
    info = { path: top, name: repoLabel(remote, top), branch: (branch || '').trim() || null };
  }
  repoCache.set(dir, { at: Date.now(), info });
  return info;
}

async function externalRepos(session, ownPath) {
  const dirs = new Set();
  const edited = (session.actions || []).filter((a) => EDIT_TOOLS.includes(a.tool) && a.detail).map((a) => path.dirname(path.resolve(session.cwd, a.detail)));
  for (const dir of [...(session.editedDirs || []), ...edited]) {
    let existing = dir;
    while (existing !== '/' && !fs.existsSync(existing)) existing = path.dirname(existing);
    dirs.add(existing);
  }
  const repos = new Map();
  for (const dir of dirs) {
    const info = await repoOf(dir);
    if (info && info.path !== ownPath) repos.set(info.path, info);
  }
  return [...repos.values()];
}

async function describe(wt) {
  const [status, numstat, lastCommit] = await Promise.all([
    git(wt.path, ['status', '--porcelain=v2', '--branch']),
    git(wt.path, ['diff', '--numstat']),
    git(wt.path, ['log', '-1', '--format=%s%x00%ct']),
  ]);
  const name = worktreeName(wt.path);
  const repo = wt.repo || REPO;
  const otherRepo = repo !== REPO;
  return {
    ...describeWorktree(wt, name, { status, numstat, lastCommit }, readReview(name)),
    repo,
    otherRepo,
    repoName: otherRepo ? (await repoOf(repo))?.name || path.basename(repo) : null,
    label: otherRepo ? path.basename(isMainCheckout(wt) ? repo : wt.path) : name,
    baseBranch: await baseBranchOf(repo),
    mainCheckout: isMainCheckout(wt),
  };
}

module.exports = { listWorktrees, findWorktree, worktreeName, isMainCheckout, defaultBranch, baseBranchOf, livePanes, hasTranscript, repoOf, externalRepos, describe };
