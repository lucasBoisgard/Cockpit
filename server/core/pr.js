function checkState(c) {
  const conclusion = String(c.conclusion || c.state || '').toUpperCase();
  const status = String(c.status || '').toUpperCase();
  if (c.__typename === 'CheckRun' && status && status !== 'COMPLETED') return 'pending';
  if (['PENDING', 'EXPECTED', 'QUEUED', 'IN_PROGRESS'].includes(conclusion)) return 'pending';
  if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(conclusion)) return 'failing';
  return 'passing';
}

function summarizePr(raw) {
  const checks = (raw.statusCheckRollup || []).map((c) => ({ name: c.name || c.context || '?', state: checkState(c), url: c.detailsUrl || c.targetUrl || null, startedAt: c.startedAt || null, completedAt: c.completedAt || null }));
  return {
    number: raw.number,
    url: raw.url,
    title: raw.title,
    state: raw.state,
    base: raw.baseRefName || null,
    draft: !!raw.isDraft,
    review: raw.reviewDecision || null,
    mergeState: raw.mergeStateStatus || null,
    checks,
    failing: checks.filter((c) => c.state === 'failing').length,
    pending: checks.filter((c) => c.state === 'pending').length,
    passing: checks.filter((c) => c.state === 'passing').length,
  };
}

function prEvents(before, pr) {
  if (!pr || !before) return [];
  return [
    !before.failing && pr.failing ? { type: 'ci_failed', message: `CI en échec sur la PR #${pr.number}` } : null,
    before.state !== 'MERGED' && pr.state === 'MERGED' ? { type: 'merged', message: `PR #${pr.number} mergée : le worktree peut être archivé` } : null,
  ].filter(Boolean);
}

function summarizeReviews(reviews) {
  return (reviews || []).map((r) => ({ author: r.author?.login || '?', state: r.state, body: String(r.body || '').slice(0, 400), at: r.submittedAt }));
}

function runIdsOf(url) {
  const ids = String(url || '').match(/actions\/runs\/(\d+)(?:\/job\/(\d+))?/);
  return ids ? { run: ids[1], job: ids[2] || null } : null;
}

function checkFailureText(failing, number, log) {
  return `Le check « ${failing.name} » échoue sur la PR #${number}${failing.url ? ` (${failing.url})` : ''}.${log ? `\n\nFin du log en échec :\n\`\`\`\n${log}\n\`\`\`` : ''}\n\nAnalyse la cause et corrige-la.`;
}

const DEFAULT_PR_TEMPLATE = '## TL;DR\n\n\n## Ticket\n\n{ticket}\n\n## Points d\'attention\n\n\n## Comment tester\n\n';

function draftOf(branch, commits, template) {
  const ticket = branch.match(/[A-Z]+-\d+/i)?.[0]?.toUpperCase() || '';
  return {
    title: commits.length === 1 ? commits[0] : commits[commits.length - 1] || branch,
    body: (template || DEFAULT_PR_TEMPLATE).replace('{ticket}', ticket),
  };
}

function prCreateArgs({ title, body, base, head, draft, labels, assignee }) {
  return ['pr', 'create', '--title', String(title).trim(), '--body', String(body || ''), '--base', base, '--head', head, ...(draft ? ['--draft'] : []), ...labels.flatMap((l) => ['--label', l]), ...(assignee ? ['--assignee', String(assignee)] : [])];
}

function verifyCreatedPr(pr, labels, assignee) {
  const names = (pr.labels || []).map((l) => l.name);
  return {
    url: pr.url,
    number: pr.number,
    labels: labels.every((l) => names.includes(l)),
    assignee: !assignee || (pr.assignees || []).some((a) => a.login === assignee),
    footer: !/Generated with \[?Claude Code/i.test(pr.body || ''),
  };
}

module.exports = { checkState, summarizePr, prEvents, summarizeReviews, runIdsOf, checkFailureText, draftOf, prCreateArgs, verifyCreatedPr };
