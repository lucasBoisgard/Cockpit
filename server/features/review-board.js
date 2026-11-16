const { REPO, CONFIG } = require('../config');
const { gh, ghAvailable } = require('../io/exec');
const { boardSettings, boardFilter, parseBoardLines, classifyBoard, retryDelay } = require('../core/review-board');
const { invalidateSnapshot } = require('../cache');

const REFRESH_MS = 3 * 60 * 1000;
const BOARD_TIMEOUT_MS = 120 * 1000;

const QUERY = `query($org: String!, $number: Int!, $filter: String!, $endCursor: String) {
  organization(login: $org) {
    projectV2(number: $number) {
      items(first: 100, after: $endCursor, query: $filter) {
        pageInfo { hasNextPage endCursor }
        nodes {
          status: fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          owner: fieldValueByName(name: "Owner") { ... on ProjectV2ItemFieldSingleSelectValue { name } }
          content { ... on PullRequest { number title url isDraft state author { login } repository { nameWithOwner } } }
        }
      }
    }
  }
}`;

const settings = boardSettings(CONFIG);
let board = { toReview: [], mine: [], at: 0, error: null };
let me = null;
let nextAt = 0;
let failures = 0;
let running = false;

function fail(error) {
  failures++;
  board = { ...board, error };
  nextAt = Date.now() + retryDelay(failures);
  invalidateSnapshot();
}

async function login() {
  if (me) return me;
  const result = await gh(REPO, ['api', 'user', '--jq', '.login']);
  me = result.ok ? result.stdout.trim() || null : null;
  return me;
}

async function refreshBoard() {
  if (!settings || !ghAvailable || running || Date.now() < nextAt) return;
  running = true;
  try {
    const user = await login();
    if (!user) return fail('gh n’est pas connecté à GitHub (gh auth status)');
    const result = await gh(REPO, ['api', 'graphql', '--paginate', '-f', `query=${QUERY}`, '-f', `org=${settings.org}`, '-F', `number=${settings.number}`, '-f', `filter=${boardFilter(settings)}`, '--jq', '.data.organization.projectV2.items.nodes[]'], { timeout: BOARD_TIMEOUT_MS });
    if (!result.ok) return fail(/read:project/.test(result.stderr) ? 'gh n’a pas le scope read:project (gh auth refresh -s read:project)' : `Board de review illisible : ${result.stderr.trim().split('\n').pop().slice(0, 160)}`);
    failures = 0;
    board = { ...classifyBoard(parseBoardLines(result.stdout), user, settings), at: Date.now(), error: null };
    nextAt = Date.now() + REFRESH_MS;
    invalidateSnapshot();
  } finally {
    running = false;
  }
}

function reviewBoardState() {
  if (!settings) return null;
  refreshBoard().catch(() => {});
  return { url: settings.url, toReview: board.toReview, mine: board.mine, at: board.at, error: board.error };
}

module.exports = { reviewBoardState, refreshBoard };
