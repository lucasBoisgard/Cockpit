const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const m = require('../server/core/matrix');
const providers = require('../server/core/providers');

const defaults = {
  version: 1,
  models: [],
  categories: [
    { id: 'explore', label: 'Explorer', picks: [{ provider: 'claude', model: 'haiku', effort: 'low', score: 5, why: 'rapide' }, { provider: 'codex', model: 'gpt-6-luna', effort: 'low', score: 4, why: '' }] },
    { id: 'review', label: 'Revue', picks: [{ provider: 'claude', model: 'opus', effort: 'high', score: 5, why: '' }] },
  ],
};

test('the versioned default matrix is valid against the providers', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'data', 'model-matrix.json'), 'utf8'));
  const catalogs = { claude: providers.CLAUDE_MODELS, codex: providers.CODEX_DEFAULT_MODELS };
  for (const c of data.categories) assert.ok(m.validateCategory(c, catalogs).category, `catégorie ${c.id} invalide : ${m.validateCategory(c, catalogs).error}`);
  assert.ok(data.categories.length >= 8);
});

test('every Claude and GPT model has a complete card and a place in at least one category', () => {
  const data = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'data', 'model-matrix.json'), 'utf8'));
  const used = new Set(data.categories.flatMap((c) => c.picks.map((p) => `${p.provider}|${p.model}`)));
  const all = [...providers.CLAUDE_MODELS.map((id) => `claude|${id}`), ...providers.CODEX_DEFAULT_MODELS.map((id) => `codex|${id}`)];
  for (const key of all) {
    const card = data.models.find((x) => `${x.provider}|${x.model}` === key);
    assert.ok(card, `${key} n'a pas de fiche`);
    assert.ok(card.cost != null && card.speed != null && card.context && card.summary, `${key} a une fiche incomplète`);
    assert.ok(used.has(key), `${key} n'est dans aucune catégorie`);
  }
});

test('mergeMatrix lets a local edit replace a category and add new ones', () => {
  const merged = m.mergeMatrix(defaults, { categories: { review: { label: 'Revue croisée', picks: [] }, perf: { label: 'Performance', picks: [] } } });
  assert.deepStrictEqual(merged.categories.map((c) => [c.id, c.label, c.source]), [['explore', 'Explorer', 'default'], ['review', 'Revue croisée', 'local'], ['perf', 'Performance', 'local']]);
});

test('validateCategory checks models, efforts, scores and duplicates', () => {
  const catalogs = { codex: [{ id: 'gpt-6-luna', efforts: ['low', 'medium'] }] };
  const ok = m.validateCategory({ id: 'tests', label: 'Tests', picks: [{ provider: 'claude', model: 'Sonnet', effort: 'medium', score: '4', why: 'x' }, { provider: 'codex', model: 'gpt-6-luna', effort: 'low', score: 3 }] }, catalogs);
  assert.deepStrictEqual(ok.category.picks.map((p) => [p.provider, p.model, p.effort, p.score]), [['claude', 'sonnet', 'medium', 4], ['codex', 'gpt-6-luna', 'low', 3]]);
  assert.ok(m.validateCategory({ id: 'Tests!', label: 'x' }).error);
  assert.ok(m.validateCategory({ id: 't', label: 'x', picks: [{ provider: 'codex', model: 'gpt-6-luna', effort: 'max', score: 3 }] }, catalogs).error);
  assert.ok(m.validateCategory({ id: 't', label: 'x', picks: [{ provider: 'claude', model: 'opus', score: 6 }] }).error);
  assert.ok(m.validateCategory({ id: 't', label: 'x', picks: [{ provider: 'claude', model: 'opus', score: 3 }, { provider: 'claude', model: 'opus', score: 4 }] }).error);
  assert.ok(m.validateCategory({ id: 't', label: 'x', picks: [{ provider: 'claude', score: 3 }] }).error);
});

test('ratings are aggregated per category, provider, model and effort', () => {
  const agg = m.aggregateRatings([
    { category: 'explore', provider: 'claude', model: 'haiku', effort: 'low', score: 2, note: 'a raté des usages', at: 1, agent: 'w1' },
    { category: 'explore', provider: 'claude', model: 'haiku', effort: 'low', score: 3, at: 2 },
    { provider: 'claude', model: 'haiku', effort: 'low', score: 5 },
  ]);
  assert.deepStrictEqual(agg['explore|claude|haiku|low'], { category: 'explore', provider: 'claude', model: 'haiku', effort: 'low', sum: 5, n: 2, notes: [{ at: 1, score: 2, note: 'a raté des usages', agent: 'w1' }], avg: 2.5 });
  assert.strictEqual(Object.keys(agg).length, 1);
  assert.ok(m.validateRating({ score: 0 }).error);
  assert.deepStrictEqual(m.validateRating({ score: '4', note: ' bien ' }), { score: 4, note: 'bien' });
});

test('a combination rated at least twice outside the matrix is ranked as observed', () => {
  const matrix = m.mergeMatrix(defaults);
  const rate = (model, effort, score) => ({ category: 'explore', provider: 'claude', model, effort, score });
  const ratings = m.aggregateRatings([rate('sonnet', 'medium', 5), rate('sonnet', 'medium', 4), rate('fable', 'low', 5), rate(null, 'low', 4), rate(null, 'low', 4)]);
  const rec = m.recommend(matrix, 'explore', { ratings });
  const off = rec.picks.find((p) => p.model === 'sonnet');
  assert.deepStrictEqual([off.offMatrix, off.score, off.rank, off.observed.n], [true, null, m.blended(m.OFF_MATRIX_PRIOR, { sum: 9, n: 2 }), 2]);
  assert.ok(!rec.picks.some((p) => p.model === 'fable'), 'a single rating outside the matrix stays hidden');
  assert.ok(rec.picks.every((p) => p.model), 'a rating without a model never becomes a pick');
  assert.ok(!rec.picks.find((p) => p.model === 'haiku').offMatrix);
});

test('recommend blends observed ratings into the reference score and puts unavailable providers last', () => {
  const matrix = m.mergeMatrix(defaults);
  const ratings = m.aggregateRatings([1, 2, 3, 4].map((i) => ({ category: 'explore', provider: 'claude', model: 'haiku', effort: 'low', score: 2, at: i })));
  const rec = m.recommend(matrix, 'explore', { ratings });
  assert.deepStrictEqual(rec.picks.map((p) => [p.model, p.rank]), [['gpt-6-luna', 4], ['haiku', 3]]);
  assert.deepStrictEqual(rec.picks[1].observed.n, 4);
  const offline = m.recommend(matrix, 'explore', { ratings, available: { codex: false } });
  assert.deepStrictEqual(offline.picks.map((p) => [p.model, p.available]), [['haiku', true], ['gpt-6-luna', false]]);
  assert.strictEqual(m.recommend(matrix, 'nope'), null);
  assert.strictEqual(m.blended(5, null), 5);
});

test('calibrationCoverage lists available picks scored high enough that lack ratings', () => {
  const matrix = { categories: [{ id: 'debug', picks: [
    { provider: 'claude', model: 'fable', effort: 'medium', score: 5 },
    { provider: 'claude', model: 'haiku', effort: 'low', score: 2 },
    { provider: 'codex', model: 'gpt-6', effort: 'high', score: 4 },
  ] }, { id: 'explore', picks: [{ provider: 'claude', model: 'haiku', effort: 'low', score: 3 }] }] };
  const ratings = m.aggregateRatings([
    { category: 'debug', provider: 'claude', model: 'fable', effort: 'medium', score: 4 },
    { category: 'debug', provider: 'claude', model: 'fable', effort: 'medium', score: 5 },
    { category: 'explore', provider: 'claude', model: 'haiku', effort: 'low', score: 3 },
    { category: 'debug', provider: 'claude', model: 'other', effort: 'low', score: 5 },
  ]);
  const c = m.calibrationCoverage(matrix, ratings, { available: { claude: true, codex: true } });
  assert.deepStrictEqual([c.total, c.done, c.complete, c.target], [3, 1, false, 2]);
  assert.deepStrictEqual(c.missing.map((x) => [x.category, x.model, x.n]), [['debug', 'gpt-6', 0], ['explore', 'haiku', 1]]);
  const noCodex = m.calibrationCoverage(matrix, ratings, { available: { claude: true, codex: false } });
  assert.strictEqual(noCodex.total, 2);
  assert.strictEqual(m.calibrationCoverage({ categories: [] }, {}, {}).complete, true);
});

test('rescorePicks updates a listed pick, adds a missing one and refuses a full category', () => {
  const picks = [{ provider: 'claude', model: 'fable', effort: 'medium', score: 3, why: 'old' }];
  const updated = m.rescorePicks(picks, { provider: 'claude', model: 'fable', effort: 'medium', score: 4, why: 'new' });
  assert.deepStrictEqual(updated.picks, [{ provider: 'claude', model: 'fable', effort: 'medium', score: 4, why: 'new' }]);
  const added = m.rescorePicks(picks, { provider: 'codex', model: 'gpt-6', effort: 'high', score: 5, why: 'x' });
  assert.strictEqual(added.picks.length, 2);
  const full = Array.from({ length: 8 }, (_, i) => ({ provider: 'claude', model: `m${i}`, effort: null, score: 3, why: '' }));
  assert.ok(m.rescorePicks(full, { provider: 'claude', model: 'z', effort: null, score: 3, why: 'x' }).error);
});
