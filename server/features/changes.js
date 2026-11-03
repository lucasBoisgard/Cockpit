const fs = require('node:fs');
const path = require('node:path');
const { BASE_BRANCH } = require('../config');
const { run, git } = require('../io/exec');
const { validSha, rangeSpec, baseRefs, parseChanges, parseCommitLog } = require('../core/git');
const { findWorktree } = require('./worktrees');
const { snapshot } = require('./snapshot');
const { cachedPr } = require('./pr');

const COMMITS_MAX = 200;
const BASE_FETCH_MS = 60000;
const baseFetchedAt = new Map();

async function fetchBase(wtPath, branch) {
  const key = `${wtPath}\0${branch}`;
  if (Date.now() - (baseFetchedAt.get(key) || 0) < BASE_FETCH_MS) return;
  baseFetchedAt.set(key, Date.now());
  await run('git', ['-C', wtPath, 'fetch', '-q', 'origin', branch]);
}

async function changesTarget(targetPath) {
  const wt = await findWorktree(targetPath);
  if (wt) return wt;
  const repo = (await snapshot()).worktrees.flatMap((w) => w.sessions.flatMap((s) => s.externalRepos || [])).find((r) => r.path === targetPath);
  return repo ? { path: repo.path, branch: repo.branch, external: true } : null;
}

async function defaultBranch(repoPath) {
  const head = ((await git(repoPath, ['rev-parse', '--abbrev-ref', 'origin/HEAD'])) || '').trim();
  if (head.startsWith('origin/')) return head.slice('origin/'.length);
  for (const branch of ['main', 'master']) if (await git(repoPath, ['rev-parse', '--verify', '-q', `origin/${branch}`])) return branch;
  return BASE_BRANCH;
}

async function ticketBase(wt) {
  const { fetch, refs } = wt.external ? baseRefs(null, await defaultBranch(wt.path)) : baseRefs(cachedPr(wt.branch)?.base, BASE_BRANCH);
  await fetchBase(wt.path, fetch);
  for (const ref of refs) {
    const sha = ((await git(wt.path, ['merge-base', 'HEAD', ref])) || '').trim();
    if (validSha(sha)) return { ref, sha };
  }
  return null;
}

async function prBase(wt) {
  const pr = !wt.external && cachedPr(wt.branch);
  if (!pr || pr.state !== 'OPEN') return null;
  const sha = ((await git(wt.path, ['merge-base', 'HEAD', `origin/${wt.branch}`])) || '').trim();
  return validSha(sha) ? { number: pr.number, branch: wt.branch, sha } : null;
}

async function rangeArgs(wt, range) {
  const spec = rangeSpec(range);
  if (!spec || spec.args) return spec?.args || null;
  const base = spec.base === 'pr' ? await prBase(wt) : await ticketBase(wt);
  return base ? [base.sha] : null;
}

async function changesSince(wtPath, since) {
  const wt = await changesTarget(wtPath);
  const args = wt && (await rangeArgs(wt, since));
  if (!args) return null;
  const [numstat, names, untracked] = await Promise.all([
    git(wtPath, ['diff', '--numstat', ...args]),
    git(wtPath, ['diff', '--name-status', ...args]),
    ['branch', 'pr', 'work'].includes(since) ? git(wtPath, ['ls-files', '--others', '--exclude-standard']) : '',
  ]);
  if (numstat === null) return null;
  return parseChanges(numstat, names, untracked);
}

async function ticketCommits(wtPath) {
  const wt = await changesTarget(wtPath);
  const [base, pr] = wt ? await Promise.all([ticketBase(wt), prBase(wt)]) : [];
  if (!base) return null;
  const log = (await git(wtPath, ['log', '--no-merges', `--max-count=${COMMITS_MAX}`, '--format=%H%x1f%ct%x1f%s', `${base.sha}..HEAD`])) || '';
  return { base: base.ref.replace(/^origin\//, ''), commits: parseCommitLog(log), pr: pr && { number: pr.number, branch: pr.branch } };
}

async function diff(wtPath, file, since) {
  const wt = await changesTarget(wtPath);
  if (!wt) return null;
  const full = path.resolve(wtPath, file);
  if (!full.startsWith(`${wtPath}/`)) return null;
  if (since && since !== 'work') {
    const args = await rangeArgs(wt, since);
    if (!args) return null;
    const out = (await git(wtPath, ['diff', ...args, '--', file])) || '';
    if (out || (since !== 'branch' && since !== 'pr')) return out;
  }
  const tracked = await git(wtPath, ['ls-files', '--error-unmatch', '--', file]);
  if (tracked !== null) return (await git(wtPath, ['diff', '--', file])) || '';
  const untracked = fs.statSync(full, { throwIfNoEntry: false })?.isDirectory()
    ? ((await git(wtPath, ['ls-files', '--others', '--exclude-standard', '--', file])) || '').split('\n').filter(Boolean)
    : [file];
  const diffs = await Promise.all(untracked.map(async (f) => (await run('git', ['-C', wtPath, 'diff', '--no-index', '--', '/dev/null', f])).stdout));
  return diffs.join('');
}

module.exports = { changesSince, ticketCommits, diff };
