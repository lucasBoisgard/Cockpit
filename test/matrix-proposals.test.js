const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const proposals = require('../server/core/matrix-proposals');
const matrix = require('../server/core/matrix');
const publish = require('../server/core/matrix-publish');

const category = { id: 'explore', picks: [{ provider: 'claude', model: 'haiku', effort: 'low', score: 5, why: 'ref' }] };
const target = { provider: 'claude', model: 'haiku', effort: 'low', score: 4, why: 'one failed arena', author: 'w1 (m)', at: 10 };

test('a proposal keeps the previous value and is pending', () => {
  const p = proposals.createProposal(category, target);
  assert.strictEqual(p.status, 'pending');
  assert.deepStrictEqual(p.previous, { score: 5, why: 'ref' });
  assert.strictEqual(proposals.createProposal(category, { ...target, model: 'fable' }).previous, null);
});

test('a pending proposal does not change the matrix the recommendation reads', () => {
  const edits = proposals.addProposal({}, proposals.createProposal(category, target));
  const applied = matrix.applyEdits({ categories: [category] }, edits);
  assert.strictEqual(applied.categories[0].picks[0].score, 5);
  assert.strictEqual(proposals.pendingProposals(edits).length, 1);
});

test('a new proposal on the same pick replaces the pending one', () => {
  let edits = proposals.addProposal({}, proposals.createProposal(category, target));
  edits = proposals.addProposal(edits, proposals.createProposal(category, { ...target, score: 3, at: 11 }));
  assert.deepStrictEqual(proposals.pendingProposals(edits).map((p) => p.score), [3]);
});

test('validate applies the proposal and revert restores the previous value', () => {
  const p = proposals.createProposal(category, target);
  const decided = proposals.decide(proposals.addProposal({}, p), p.id, 'validated', 20);
  assert.strictEqual(decided.edits.proposals[0].status, 'validated');
  assert.strictEqual(proposals.pendingProposals(decided.edits).length, 0);
  const applied = proposals.applyProposal(category.picks, decided.proposal);
  assert.strictEqual(applied.picks[0].score, 4);
  assert.strictEqual(proposals.revertPicks(applied.picks, decided.proposal).picks[0].score, 5);
  const added = proposals.createProposal(category, { ...target, model: 'fable', effort: 'medium' });
  assert.strictEqual(proposals.revertPicks(proposals.applyProposal(category.picks, added).picks, added).picks.length, 1);
});

test('reject keeps the proposal as history and a decided one cannot be decided again', () => {
  const p = proposals.createProposal(category, target);
  const rejected = proposals.decide(proposals.addProposal({}, p), p.id, 'rejected', 20);
  assert.strictEqual(rejected.edits.proposals[0].status, 'rejected');
  assert.ok(proposals.decide(rejected.edits, p.id, 'validated', 30).error);
  assert.ok(proposals.decide({}, 'nope', 'rejected', 30).error);
});

test('publication carries proposals and their decisions', () => {
  const p = proposals.createProposal(category, target);
  const ancestor = { edits: {}, ratings: [] };
  const remote = { edits: {}, ratings: [] };
  const local = { edits: proposals.addProposal({}, p), ratings: [] };
  const first = publish.mergeForPublish({ ancestor, local, remote });
  assert.deepStrictEqual(first.proposals, [p.id]);
  assert.strictEqual(first.edits.proposals.length, 1);
  assert.match(publish.commitMessage(first), /1 rescore proposal/);
  const decided = { edits: proposals.decide(local.edits, p.id, 'rejected', 5).edits, ratings: [] };
  const second = publish.mergeForPublish({ ancestor: local, local: decided, remote: first });
  assert.strictEqual(second.edits.proposals[0].status, 'rejected');
  assert.deepStrictEqual(publish.mergeForPublish({ ancestor: local, local, remote: first }).proposals, []);
});

test('the published data keeps the reference defaults and the master rescores pending', () => {
  const data = path.join(__dirname, '..', 'server', 'data');
  const defaults = JSON.parse(fs.readFileSync(path.join(data, 'model-matrix.json'), 'utf8'));
  const edits = JSON.parse(fs.readFileSync(path.join(data, 'model-matrix-edits.json'), 'utf8'));
  const applied = matrix.applyEdits(defaults, edits);
  const pick = (cat, model) => applied.categories.find((c) => c.id === cat).picks.find((p) => p.model === model);
  assert.strictEqual(pick('large-context', 'fable').score, 3);
  assert.strictEqual(pick('explore', 'haiku').score, 5);
  assert.strictEqual(pick('frontend', 'fable'), undefined);
  assert.strictEqual(proposals.pendingProposals(edits).length, 3);
});

const os = require('node:os');
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-proposals-home-'));
process.env.HOME = home;
fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
const feature = require('../server/features/matrix');
const { readJson } = require('../server/io/store');

const overrides = () => readJson(path.join(home, '.claude', 'worktree-matrix.json')) || {};
const combo = { category: 'explore', provider: 'claude', model: 'haiku', effort: 'low', why: 'evidence' };

test('rescorePick records a pending proposal and refuses invalid ones', async () => {
  assert.ok((await feature.rescorePick({ ...combo, score: 4.5 })).error);
  assert.ok((await feature.rescorePick({ ...combo, score: 6 })).error);
  assert.ok((await feature.rescorePick({ ...combo, score: 4, model: 'nope' })).error);
  assert.ok((await feature.rescorePick({ ...combo, score: 4, why: ' ' })).error);
  assert.ok((await feature.rescorePick({ ...combo, score: 4, category: 'unknown' })).error);
  assert.strictEqual(overrides().proposals, undefined);
  const result = await feature.rescorePick({ ...combo, score: 3, author: 'w2' });
  assert.strictEqual(result.pending, true);
  assert.strictEqual(overrides().proposals[0].author, 'w2');
  const matrixNow = await feature.getMatrix();
  assert.strictEqual(matrixNow.proposals.length, 1);
  assert.strictEqual(matrixNow.categories.find((c) => c.id === 'explore').picks.find((p) => p.model === 'haiku' && p.effort === 'low').score, 5);
});

test('decideProposal validate writes the right category, reject writes none, statuses are filtered', async () => {
  const [pending] = (await feature.getMatrix()).proposals;
  assert.ok((await feature.decideProposal({ id: pending.id, decision: 'maybe' })).error);
  assert.ok((await feature.decideProposal({ id: 'missing', decision: 'validate' })).error);
  assert.deepStrictEqual(await feature.decideProposal({ id: pending.id, decision: 'validate' }), { ok: true });
  const saved = overrides();
  assert.strictEqual(saved.categories.explore.picks.find((p) => p.model === 'haiku' && p.effort === 'low').score, 3);
  assert.deepStrictEqual(Object.keys(saved.categories), ['explore']);
  const after = await feature.getMatrix();
  assert.strictEqual(after.proposals.length, 0);
  assert.strictEqual(after.applied.length, 1);
  assert.ok((await feature.decideProposal({ id: pending.id, decision: 'validate' })).error);

  const second = await feature.rescorePick({ ...combo, score: 2 });
  assert.deepStrictEqual(await feature.decideProposal({ id: second.id, decision: 'reject' }), { ok: true });
  assert.strictEqual(overrides().categories.explore.picks.find((p) => p.model === 'haiku' && p.effort === 'low').score, 3);
  assert.strictEqual((await feature.getMatrix()).applied.length, 1);
});

test('revertProposal restores the previous value and refuses once the category changed', async () => {
  const [applied] = (await feature.getMatrix()).applied;
  assert.deepStrictEqual(await feature.revertProposal({ id: applied.id }), { ok: true });
  assert.strictEqual(overrides().categories.explore.picks.find((p) => p.model === 'haiku' && p.effort === 'low').score, 5);
  assert.ok((await feature.revertProposal({ id: applied.id })).error);

  const next = await feature.rescorePick({ ...combo, score: 4 });
  await feature.decideProposal({ id: next.id, decision: 'validate' });
  const [validated] = (await feature.getMatrix()).applied;
  const category = overrides().categories.explore;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await feature.saveCategory({ ...category, picks: category.picks.map((p) => ({ ...p, score: Math.min(5, p.score + (p.model === 'opus' ? 0 : 0)) })) });
  const refused = await feature.revertProposal({ id: validated.id });
  assert.match(refused.error, /a changé/);
});

test('validation captures the value held at that moment, so reverting keeps an edit made after the proposal', async () => {
  const proposed = await feature.rescorePick({ ...combo, score: 3 });
  const category = overrides().categories.explore;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await feature.saveCategory({ ...category, picks: category.picks.map((p) => (p.model === 'haiku' && p.effort === 'low' ? { ...p, score: 4 } : p)) });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await feature.decideProposal({ id: proposed.id, decision: 'validate' });
  const [validated] = (await feature.getMatrix()).applied.slice(-1);
  assert.strictEqual(validated.previous.score, 4);
  assert.deepStrictEqual(await feature.revertProposal({ id: validated.id }), { ok: true });
  assert.strictEqual(overrides().categories.explore.picks.find((p) => p.model === 'haiku' && p.effort === 'low').score, 4);
});
