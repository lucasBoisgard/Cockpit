const fs = require('node:fs');
const path = require('node:path');
const { REPO, CLAUDE_SESSIONS_DIR } = require('../config');
const { git, tmux } = require('../io/exec');
const { processAlive } = require('../io/proc');
const { readReview } = require('../io/store');
const { parseWorktreeList, describeWorktree, repoLabel } = require('../core/git');
const { EDIT_TOOLS } = require('../core/transcript');

const REPO_CACHE_TTL_MS = 30000;
const repoCache = new Map();

async function listWorktrees() {
  return parseWorktreeList(await git(REPO, ['worktree', 'list', '--porcelain'])).filter((wt) => fs.existsSync(wt.path));
}

const findWorktree = async (wtPath) => (await listWorktrees()).find((wt) => wt.path === wtPath) || null;

const worktreeName = (wtPath) => (wtPath === REPO ? 'main' : path.basename(wtPath));

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
  return describeWorktree(wt, name, { status, numstat, lastCommit }, readReview(name));
}

module.exports = { listWorktrees, findWorktree, worktreeName, livePanes, hasTranscript, repoOf, externalRepos, describe };
