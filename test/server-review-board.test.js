const test = require('node:test');
const assert = require('node:assert');
const { boardSettings, boardFilter, parseBoardLines, classifyBoard, retryDelay } = require('../server/core/review-board');

const node = (number, status, author, extra = {}) => JSON.stringify({
  status: status ? { name: status } : null,
  owner: null,
  content: { number, title: `PR ${number}`, url: `https://x/${number}`, isDraft: false, state: 'OPEN', author: { login: author }, ...extra },
});

test('the board is off without an org and a project number, and keeps default statuses otherwise', () => {
  assert.strictEqual(boardSettings({}), null);
  assert.strictEqual(boardSettings({ reviewBoard: { org: 'acme' } }), null);
  assert.strictEqual(boardSettings({ reviewBoard: { org: 'acme', number: null } }), null);
  assert.strictEqual(boardSettings({ reviewBoard: { org: 'acme', number: 0 } }), null);
  const settings = boardSettings({ reviewBoard: { org: 'acme', number: 28, view: 1 } });
  assert.deepStrictEqual(settings, { org: 'acme', number: 28, url: 'https://github.com/orgs/acme/projects/28/views/1', toReview: ['To Review'], mine: ['Questions', 'Changes Requested'] });
  assert.deepStrictEqual(boardSettings({ reviewBoard: { org: 'acme', number: '3', statuses: { toReview: ['Ready'] } } }).toReview, ['Ready']);
});

test('board lines skip issues, drafts of notes and broken lines', () => {
  const items = parseBoardLines([node(1, 'To Review', 'bob'), JSON.stringify({ status: { name: 'To Review' }, content: {} }), '{broken', ''].join('\n'));
  assert.deepStrictEqual(items.map((i) => [i.number, i.status, i.author]), [[1, 'To Review', 'bob']]);
});

test('to review lists open non-draft pull requests of others, mine lists my pull requests that need an answer', () => {
  const items = parseBoardLines([
    node(5, 'To Review', 'bob'),
    node(2, 'To Review', 'Alex'),
    node(3, 'To Review', 'bob', { isDraft: true }),
    node(4, 'To Review', 'bob', { state: 'MERGED' }),
    node(6, 'Done', 'bob'),
    node(7, 'Changes Requested', 'alex'),
    node(8, 'Questions', 'alex'),
    node(9, 'Changes Requested', 'bob'),
    node(10, 'In Review', 'alex'),
  ].join('\n'));
  const { toReview, mine } = classifyBoard(items, 'alex', boardSettings({ reviewBoard: { org: 'acme', number: 1 } }));
  assert.deepStrictEqual(toReview.map((i) => i.number), [5]);
  assert.deepStrictEqual(mine.map((i) => [i.number, i.status]), [[7, 'Changes Requested'], [8, 'Questions']]);
});

test('the board filter asks GitHub only for open non-draft items in the watched statuses', () => {
  const settings = boardSettings({ reviewBoard: { org: 'acme', number: 1, statuses: { toReview: ['To Review'], mine: ['Questions', 'To Review', 'Say "hi"'] } } });
  assert.strictEqual(boardFilter(settings), 'is:open -is:draft status:"To Review","Questions","Say hi"');
});

test('a failing board is retried after one, then five, then fifteen minutes', () => {
  assert.deepStrictEqual([1, 2, 3, 9].map(retryDelay), [60000, 300000, 900000, 900000]);
});
