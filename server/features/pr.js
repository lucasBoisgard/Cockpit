const { REPO, CONFIG } = require('../config');
const { run, git, gh, ghAvailable } = require('../io/exec');
const { readReview, sessionsIn } = require('../io/store');
const { summarizePr, prEvents, summarizeReviews, runIdsOf, checkFailureText, draftOf, prCreateArgs, verifyCreatedPr } = require('../core/pr');
const { stripAnsi } = require('../core/app');
const { invalidateSnapshot } = require('../cache');
const { listWorktrees, worktreeName, isMainCheckout, baseBranchOf } = require('./worktrees');
const { pushEvent } = require('./events');
const { deliver } = require('./queue');

const PR_REFRESH_MS = 60000;
const PR_FIELDS = 'number,url,title,state,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup,baseRefName';

const prCache = new Map();
let prRefreshedAt = 0;

const prKey = (branch, repo) => `${repo || REPO}\n${branch}`;
const cachedPr = (branch, repo) => (branch && prCache.get(prKey(branch, repo))?.pr) || null;

const prRefreshDue = () => Date.now() - prRefreshedAt > PR_REFRESH_MS;

async function refreshPrs(worktrees) {
  if (!ghAvailable) return;
  prRefreshedAt = Date.now();
  for (const wt of worktrees) {
    if (!wt.branch || wt.branch === (await baseBranchOf(wt.repo))) continue;
    const result = await gh(wt.repo || REPO, ['pr', 'list', '--head', wt.branch, '--state', 'all', '--limit', '1', '--json', PR_FIELDS]);
    if (!result.ok) continue;
    let list = [];
    try {
      list = JSON.parse(result.stdout);
    } catch {}
    const reviewed = !list.length && readReview(worktreeName(wt.path))?.pr;
    if (reviewed) {
      const view = await gh(wt.repo || REPO, ['pr', 'view', String(reviewed).replace(/^#/, ''), '--json', PR_FIELDS]);
      try {
        if (view.ok) list = [JSON.parse(view.stdout)];
      } catch {}
    }
    const before = cachedPr(wt.branch, wt.repo);
    const pr = list[0] ? summarizePr(list[0]) : null;
    prCache.set(prKey(wt.branch, wt.repo), { at: Date.now(), pr });
    for (const event of prEvents(before, pr)) pushEvent({ type: event.type, worktree: worktreeName(wt.path), path: wt.path, message: event.message });
  }
  invalidateSnapshot();
}

async function prDetails(wtPath) {
  const wt = (await listWorktrees()).find((w) => w.path === wtPath);
  if (!wt?.branch || !ghAvailable) return null;
  const result = await gh(wt.repo || REPO, ['pr', 'view', wt.branch, '--json', `${PR_FIELDS},reviews,mergeable,baseRefName,headRefName`]);
  if (!result.ok) return { none: true };
  try {
    const raw = JSON.parse(result.stdout);
    const pr = summarizePr(raw);
    prCache.set(prKey(wt.branch, wt.repo), { at: Date.now(), pr });
    return { ...pr, mergeable: raw.mergeable, base: raw.baseRefName, head: raw.headRefName, reviews: summarizeReviews(raw.reviews) };
  } catch {
    return null;
  }
}

async function sendCheckFailure({ path: wtPath, check }) {
  const details = await prDetails(wtPath);
  const failing = details?.checks?.find((c) => c.name === check && c.state === 'failing');
  if (!failing) return { error: 'Check introuvable ou plus en échec.' };
  const session = sessionsIn(wtPath).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  if (!session) return { error: 'Aucune session Claude dans ce worktree.' };
  const ids = runIdsOf(failing.url);
  let log = '';
  if (ids) {
    const result = await gh(wtPath, ['run', 'view', ids.run, ...(ids.job ? ['--job', ids.job] : []), '--log-failed']);
    log = stripAnsi(result.stdout).split('\n').slice(-60).join('\n');
  }
  const outcome = await deliver(session.sessionId, checkFailureText(failing, details.number, log), true);
  return outcome === 'offline' || outcome === 'unknown' ? { error: 'La session ne tourne pas dans tmux.' } : { ok: true, outcome };
}

async function pushBranch({ path: wtPath }) {
  const wt = (await listWorktrees()).find((w) => w.path === wtPath);
  if (!wt?.branch || isMainCheckout(wt)) return { error: 'Worktree sans branche, ou checkout principal.' };
  const result = await run('git', ['-C', wt.path, 'push', '-u', 'origin', wt.branch]);
  invalidateSnapshot();
  return result.ok ? { ok: true } : { error: result.stderr.trim() };
}

async function prDraft(wtPath) {
  const wt = (await listWorktrees()).find((w) => w.path === wtPath);
  if (!wt?.branch) return null;
  const base = await baseBranchOf(wt.repo);
  await run('git', ['-C', wt.path, 'fetch', '-q', 'origin', base]);
  const commits = ((await git(wt.path, ['log', `origin/${base}..HEAD`, '--format=%s'])) || '').split('\n').filter(Boolean);
  const { title, body } = draftOf(wt.branch, commits, CONFIG.pr?.template);
  return { branch: wt.branch, base, title, body, commits, labels: CONFIG.pr?.labels || [], assignee: CONFIG.pr?.assignee || '' };
}

async function createPr({ path: wtPath, title, body, labels, assignee, draft }) {
  if (!ghAvailable) return { error: 'gh n’est pas installé.' };
  const wt = (await listWorktrees()).find((w) => w.path === wtPath);
  if (!wt?.branch || isMainCheckout(wt)) return { error: 'Worktree sans branche, ou checkout principal.' };
  if (!String(title || '').trim()) return { error: 'Titre manquant.' };
  const pushed = await pushBranch({ path: wt.path });
  if (pushed.error) return pushed;
  const labelList = (Array.isArray(labels) ? labels : []).map(String).filter(Boolean);
  const created = await gh(wt.path, prCreateArgs({ title, body, base: await baseBranchOf(wt.repo), head: wt.branch, draft, labels: labelList, assignee }));
  if (!created.ok) return { error: created.stderr.trim() };
  const view = await gh(wt.path, ['pr', 'view', wt.branch, '--json', 'url,number,labels,assignees,body']);
  let check = null;
  try {
    check = verifyCreatedPr(JSON.parse(view.stdout), labelList, assignee);
  } catch {}
  prRefreshedAt = 0;
  return { ok: true, url: check?.url || created.stdout.trim(), check };
}

module.exports = { cachedPr, prRefreshDue, refreshPrs, prDetails, sendCheckFailure, pushBranch, prDraft, createPr };
