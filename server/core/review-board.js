// A GitHub Projects review board read as two lists: pull requests waiting for a review, and the user's own pull requests that need an answer.

const DEFAULT_STATUSES = { toReview: ['To Review'], mine: ['Questions', 'Changes Requested'] };

function boardSettings(config) {
  const board = config?.reviewBoard;
  if (!board?.org || !Number.isInteger(Number(board.number)) || Number(board.number) <= 0) return null;
  return {
    org: String(board.org),
    number: Number(board.number),
    url: `https://github.com/orgs/${board.org}/projects/${board.number}${board.view ? `/views/${board.view}` : ''}`,
    toReview: board.statuses?.toReview || DEFAULT_STATUSES.toReview,
    mine: board.statuses?.mine || DEFAULT_STATUSES.mine,
  };
}

function boardItem(node) {
  const pr = node?.content;
  if (!pr?.number) return null;
  return {
    number: pr.number,
    title: pr.title || '',
    url: pr.url || null,
    repo: pr.repository?.nameWithOwner || null,
    draft: !!pr.isDraft,
    state: pr.state || null,
    author: pr.author?.login || null,
    status: node.status?.name || null,
    owner: node.owner?.name || null,
  };
}

// Board search filter, so that GitHub only returns the items worth showing instead of the whole board history.
function boardFilter(settings) {
  const statuses = [...new Set([...settings.toReview, ...settings.mine])].map((s) => `"${String(s).replace(/"/g, '')}"`);
  return `is:open -is:draft status:${statuses.join(',')}`;
}

// One JSON node per line, as `gh api graphql --paginate --jq '...nodes[]'` prints them.
function parseBoardLines(text) {
  return String(text || '').split('\n').flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const item = boardItem(JSON.parse(line));
      return item ? [item] : [];
    } catch {
      return [];
    }
  });
}

const sameLogin = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

// Mirrors the board view filters `-is:draft -status:Done` on open pull requests.
function classifyBoard(items, me, settings) {
  const live = items.filter((i) => !i.draft && i.state === 'OPEN');
  const byNumber = (a, b) => a.number - b.number;
  return {
    toReview: live.filter((i) => settings.toReview.includes(i.status) && !sameLogin(i.author, me)).sort(byNumber),
    mine: live.filter((i) => settings.mine.includes(i.status) && sameLogin(i.author, me)).sort(byNumber),
  };
}

const RETRY_STEPS_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000];

const retryDelay = (failures) => RETRY_STEPS_MS[Math.min(Math.max(failures, 1), RETRY_STEPS_MS.length) - 1];

module.exports = { boardSettings, boardFilter, parseBoardLines, classifyBoard, retryDelay };
