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
  const catalogs = { claude: providers.CLAUDE_MODELS, codex: providers.CODEX_DEFAULT_MODELS.concat(['gpt-6.1-terra', 'gpt-6-sol']) };
  for (const c of data.categories) assert.ok(m.validateCategory(c, catalogs).category, `catégorie ${c.id} invalide : ${m.validateCategory(c, catalogs).error}`);
  assert.ok(data.categories.length >= 8);
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
  assert.deepStrictEqual(agg['explore|claude|haiku|low'], { sum: 5, n: 2, notes: [{ at: 1, score: 2, note: 'a raté des usages', agent: 'w1' }], avg: 2.5 });
  assert.strictEqual(Object.keys(agg).length, 1);
  assert.ok(m.validateRating({ score: 0 }).error);
  assert.deepStrictEqual(m.validateRating({ score: '4', note: ' bien ' }), { score: 4, note: 'bien' });
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
