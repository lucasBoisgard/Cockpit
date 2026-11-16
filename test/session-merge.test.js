const test = require('node:test');
const assert = require('node:assert');
const { mergeRefusal, runsOutsideCockpit, pickDelivery, handoffText } = require('../server/core/session-merge');

const wt = (path, extra = {}) => ({ path, ...extra });

test('mergeRefusal refuses an unknown, identical, main, locked or cross-repo source', () => {
  assert.match(mergeRefusal(null, wt('/b'), true), /inconnu/);
  assert.match(mergeRefusal(wt('/a'), wt('/a'), true), /lui-même/);
  assert.match(mergeRefusal(wt('/a', { mainCheckout: true }), wt('/b'), true), /checkout principal/);
  assert.match(mergeRefusal(wt('/a', { locked: true }), wt('/b'), true), /verrouillé/);
  assert.match(mergeRefusal(wt('/a'), wt('/b'), false), /même repo/);
  assert.strictEqual(mergeRefusal(wt('/a'), wt('/b', { mainCheckout: true }), true), null);
});

test('handoffText carries the branch, the unpushed commits and every session with its transcript', () => {
  const text = handoffText({
    source: 'src',
    target: 'dst',
    branch: 'feat/x',
    head: 'abc123',
    upstream: 'origin/feat/x',
    commits: ['abc123 fix: y'],
    sessions: [{ task: 'Fix the review', lastAssistant: 'Done.\nPushed.', transcriptPath: '/t/1.jsonl' }, { task: null, lastAssistant: null, transcriptPath: '/t/2.jsonl' }],
  });
  assert.match(text, /« src » est fusionné dans celui-ci \(« dst »\)/);
  assert.match(text, /Branche : feat\/x @ abc123 \(suit origin\/feat\/x\)/);
  assert.match(text, /Commits non poussés \(1\) :\n- abc123 fix: y/);
  assert.match(text, /Session 1\/2 — demande : Fix the review/);
  assert.match(text, /> Done\.\n> Pushed\./);
  assert.match(text, /\/t\/2\.jsonl/);
});

test('handoffText says when everything is pushed, when the branch has no upstream and when there is no session', () => {
  const pushed = handoffText({ source: 's', target: 't', branch: 'b', head: null, upstream: 'origin/b', commits: [], sessions: [] });
  assert.match(pushed, /Tout est poussé\./);
  assert.match(pushed, /Aucune conversation/);
  const local = handoffText({ source: 's', target: 't', branch: null, head: 'h', upstream: null, base: 'main', commits: ['h one'], sessions: [] });
  assert.match(local, /\(détachée\) @ h \(jamais poussée\)/);
  assert.match(local, /Commits depuis main \(1\)/);
});

test('handoffText clips a long last answer', () => {
  const text = handoffText({ source: 's', target: 't', branch: 'b', head: null, upstream: null, commits: [], sessions: [{ lastAssistant: 'x'.repeat(5000) }] });
  assert.ok(text.length < 4000);
  assert.match(text, /…/);
});

const none = new Set();
const s = (sessionId, updatedAt, extra = {}) => ({ sessionId, updatedAt, cwd: `/wt/${sessionId}`, hasTranscript: true, ...extra });
const exists = (cwd) => !cwd.includes('gone');

test('pickDelivery prefers the most recent live session, even without a transcript yet', () => {
  const sessions = [s('old', 1), s('fresh', 5, { hasTranscript: false }), s('stopped', 9)];
  assert.deepStrictEqual(pickDelivery({ sessions, liveIds: new Set(['old', 'fresh']), outsideIds: none, lockAlive: false, cwdExists: exists }), { kind: 'live', sessionId: 'fresh' });
});

test('pickDelivery resumes the last conversation whose folder still exists, else starts a session', () => {
  const sessions = [s('kept', 1, { provider: 'codex' }), s('removed', 9, { cwd: '/wt/gone' }), s('empty', 8, { hasTranscript: false })];
  assert.deepStrictEqual(pickDelivery({ sessions, liveIds: none, outsideIds: none, lockAlive: false, cwdExists: exists }), { kind: 'resume', sessionId: 'kept', provider: 'codex' });
  assert.deepStrictEqual(pickDelivery({ sessions: [s('removed', 9, { cwd: '/wt/gone' })], liveIds: none, outsideIds: none, lockAlive: false, cwdExists: exists }), { kind: 'start' });
});

test('a Claude running outside the cockpit blocks the merge on either side', () => {
  assert.match(pickDelivery({ sessions: [s('a', 1)], liveIds: none, outsideIds: new Set(['a']), lockAlive: false, cwdExists: exists }).error, /hors cockpit/);
  assert.match(pickDelivery({ sessions: [], liveIds: none, outsideIds: none, lockAlive: true, cwdExists: exists }).error, /hors cockpit/);
  assert.strictEqual(runsOutsideCockpit({ sessions: [s('a', 1)], liveIds: new Set(['a']), outsideIds: new Set(['a']), lockAlive: true }), false);
  assert.strictEqual(runsOutsideCockpit({ sessions: [s('a', 1)], liveIds: none, outsideIds: none, lockAlive: false }), false);
});
