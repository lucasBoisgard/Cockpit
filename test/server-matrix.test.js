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

const evidence = (category, model, effort, score, V, extra = {}) => ({ category, provider: extra.provider || 'claude', model, effort, S: score, V, confidence: V >= 6 ? 'solide' : V >= 3 ? 'moyenne' : V >= 1 ? 'faible' : 'à éprouver' });
const scoresOf = (...list) => Object.fromEntries(list.map((e) => [m.keyOf(e.category, e), e]));

test('legacyRatings keeps the ratings that have a category whatever their date', () => {
  const r = (at, category = 'explore') => ({ at, category, provider: 'claude', model: 'haiku', score: 4 });
  assert.deepStrictEqual(m.legacyRatings([r(1), r(9e15), r(2, null)]).map((x) => x.at), [1, 9e15]);
  assert.deepStrictEqual(m.legacyRatings(), []);
});

test('a pick without evidence scores its reference through the legacy map and needs proof', () => {
  const rec = m.recommend(m.mergeMatrix(defaults), 'explore');
  assert.deepStrictEqual(rec.picks.map((p) => [p.model, p.quality, p.confidence, p.verified, p.evidence]), [['haiku', 90, 'à éprouver', 0, null], ['gpt-6-luna', 75, 'à éprouver', 0, null]]);
  assert.deepStrictEqual(rec.picks.map((p) => p.goodEnough), [true, true]);
});

test('a combination verified outside the matrix appears once its evidence weighs at least 1', () => {
  const matrix = m.mergeMatrix(defaults);
  const scores = scoresOf(evidence('explore', 'sonnet', 'medium', 82, 1.2), evidence('explore', 'fable', 'low', 95, 0.6), { ...evidence('explore', null, 'low', 90, 3) });
  const rec = m.recommend(matrix, 'explore', { scores });
  const off = rec.picks.find((p) => p.model === 'sonnet');
  assert.deepStrictEqual([off.offMatrix, off.score, off.quality, off.confidence], [true, null, 82, 'faible']);
  assert.ok(!rec.picks.some((p) => p.model === 'fable'), 'weak evidence outside the matrix stays hidden');
  assert.ok(rec.picks.every((p) => p.model), 'evidence without a model never becomes a pick');
  assert.ok(!rec.picks.find((p) => p.model === 'haiku').offMatrix);
});

test('recommend scores a pick on its evidence and puts unavailable providers last', () => {
  const matrix = m.mergeMatrix(defaults);
  const scores = scoresOf(evidence('explore', 'haiku', 'low', 46, 4));
  const rec = m.recommend(matrix, 'explore', { scores });
  assert.deepStrictEqual(rec.picks.map((p) => [p.model, p.quality, p.goodEnough]), [['gpt-6-luna', 75, true], ['haiku', 46, false]]);
  assert.strictEqual(rec.picks[1].verified, 4);
  assert.strictEqual(rec.picks[1].confidence, 'moyenne');
  const offline = m.recommend(matrix, 'explore', { scores, available: { codex: false } });
  assert.deepStrictEqual(offline.picks.map((p) => [p.model, p.available]), [['haiku', true], ['gpt-6-luna', false]]);
  assert.strictEqual(m.recommend(matrix, 'nope'), null);
});

test('good enough is 70 out of 100: the cheapest of the band comes first, the rest by score', () => {
  const matrix = valueMatrix([pickOf('claude', 'opus', 'high', 5), pickOf('claude', 'sonnet', 'low', 4), pickOf('claude', 'haiku', 'low', 4)], [card('opus', 3, 1), card('sonnet', 2, 2), card('haiku', 1, 3)]);
  const scores = scoresOf(evidence('review', 'haiku', 'low', 69.6, 3), evidence('review', 'sonnet', 'low', 70, 3));
  const rec = m.recommend(matrix, 'review', { scores });
  assert.deepStrictEqual(rec.picks.map((p) => [p.model, p.goodEnough]), [['sonnet', true], ['opus', true], ['haiku', false]]);
});

test('a quality band anchored on the best score keeps the order stable', () => {
  const matrix = { models: [card('opus', 3, 1), card('sonnet', 2, 2), card('haiku', 1, 3)], categories: [{ id: 'delicate', rankBy: 'quality', label: 'S', picks: [pickOf('claude', 'opus', 'high', 5), pickOf('claude', 'sonnet', 'high', 5), pickOf('claude', 'haiku', 'high', 5)] }] };
  const order = (scores) => m.recommend(matrix, 'delicate', { scores }).picks.map((p) => p.model);
  assert.deepStrictEqual(order({}), ['haiku', 'sonnet', 'opus']);
  const scores = scoresOf(evidence('delicate', 'opus', 'high', 93, 6), evidence('delicate', 'sonnet', 'high', 90, 6), evidence('delicate', 'haiku', 'high', 86, 6));
  assert.deepStrictEqual(order(scores), ['sonnet', 'opus', 'haiku']);
  assert.deepStrictEqual(order(scores), order(scores));
});

test('calibrationCoverage lists available picks of a reference high enough whose verified weight is below 3', () => {
  const matrix = { categories: [{ id: 'debug', picks: [
    { provider: 'claude', model: 'fable', effort: 'medium', score: 5 },
    { provider: 'claude', model: 'haiku', effort: 'low', score: 2 },
    { provider: 'codex', model: 'gpt-6', effort: 'high', score: 4 },
  ] }, { id: 'explore', picks: [{ provider: 'claude', model: 'haiku', effort: 'low', score: 3 }] }] };
  const scores = scoresOf(evidence('debug', 'fable', 'medium', 80, 3.4), evidence('explore', 'haiku', 'low', 60, 1.5), evidence('debug', 'other', 'low', 90, 9));
  const c = m.calibrationCoverage(matrix, scores, { available: { claude: true, codex: true } });
  assert.deepStrictEqual([c.total, c.done, c.complete, c.target], [3, 1, false, 3]);
  assert.deepStrictEqual(c.missing.map((x) => [x.category, x.model, x.n]), [['debug', 'gpt-6', 0], ['explore', 'haiku', 1.5]]);
  const noCodex = m.calibrationCoverage(matrix, scores, { available: { claude: true, codex: false } });
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

test('applyEdits lets the published edits replace a category and add new ones, under the local edits', () => {
  const edited = m.applyEdits(defaults, { categories: { review: { label: 'Revue croisée', picks: [] }, perf: { label: 'Performance', picks: [] } } });
  assert.deepStrictEqual(edited.categories.map((c) => [c.id, c.label, c.source]), [['explore', 'Explorer', undefined], ['review', 'Revue croisée', 'published'], ['perf', 'Performance', 'published']]);
  const merged = m.mergeMatrix(edited, { categories: { perf: { label: 'Perf locale', picks: [] } } });
  assert.deepStrictEqual(merged.categories.map((c) => [c.id, c.label, c.source]), [['explore', 'Explorer', 'default'], ['review', 'Revue croisée', 'published'], ['perf', 'Perf locale', 'local']]);
});

test('a local edit equal to the category it replaces is ignored', () => {
  const merged = m.mergeMatrix(defaults, { categories: { review: { label: 'Revue', picks: defaults.categories[1].picks, editedAt: 5 } } });
  assert.strictEqual(merged.categories.find((c) => c.id === 'review').source, 'default');
});

test('combineRatings keeps the published ratings and the local ones once each, oldest first', () => {
  const r = (at, agent = 'w') => ({ at, agent, master: 'm', category: 'review', provider: 'claude', model: 'opus', score: 4 });
  const all = m.combineRatings([r(3), r(1)], [r(2), r(1)]);
  assert.deepStrictEqual(all.map((x) => x.at), [1, 2, 3]);
  assert.deepStrictEqual(m.combineRatings(undefined, {}), []);
});

test('the published edits and ratings are valid', () => {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'server', 'data', name), 'utf8'));
  const catalogs = { claude: providers.CLAUDE_MODELS, codex: providers.CODEX_DEFAULT_MODELS };
  for (const c of Object.values(read('model-matrix-edits.json').categories || {})) assert.ok(m.validateCategory(c, catalogs).category, `catégorie ${c.id} invalide : ${m.validateCategory(c, catalogs).error}`);
  const ratings = read('model-ratings.json');
  assert.ok(Array.isArray(ratings));
  for (const r of ratings) assert.ok(r.category && r.provider && r.model && Number.isInteger(r.score), `note invalide : ${JSON.stringify(r)}`);
});

const card = (model, cost, speed, provider = 'claude') => ({ provider, model, label: model, cost, speed });
const spec = (category, model, effort, provider = 'claude') => ({ category, provider, model, effort });
const row = (kind, model, effort, tokens, ms, extra = {}) => ({ role: 'agent', kind, provider: 'claude', model, effort, totals: { input: tokens, cacheWrite: 0, cacheRead: 0, output: 0 }, startedAt: 1000, workEndedAt: ms == null ? null : 1000 + ms, ...extra });

test('aggregateMeasured takes medians per pick and skips agents without category, tokens or a usable duration', () => {
  const out = m.aggregateMeasured([
    row('review', 'sonnet', 'low', 100, 60000),
    row('review', 'sonnet', 'low', 300, 120000),
    row('review', 'sonnet', 'low', 200, null),
    row('review', 'sonnet', 'low', 999, 1, { totals: null }),
    row(null, 'sonnet', 'low', 999, 1),
    row('review', 'sonnet', 'low', 999, 1, { shared: true }),
    row('review', 'sonnet', 'low', 999, 1, { role: 'master' }),
    row('review', 'opus', 'high', 50, null),
  ]);
  assert.deepStrictEqual(out['review|claude|sonnet|low'], { n: 3, tokens: 200, durationMs: 90000 });
  assert.deepStrictEqual(out['review|claude|opus|high'], { n: 1, tokens: 50, durationMs: null });
  assert.strictEqual(Object.keys(out).length, 2);
  assert.deepStrictEqual(m.aggregateMeasured(), {});
});

const valueMatrix = (picks, models) => ({ models, categories: [{ id: 'review', label: 'Revue', picks }] });
const pickOf = (provider, model, effort, score) => ({ provider, model, effort, score, why: '' });

test('a cheap good-enough pick beats a dearer better-rated one, a cheap pick below the threshold does not', () => {
  const matrix = valueMatrix(
    [pickOf('claude', 'fable', 'high', 5), pickOf('claude', 'sonnet', 'low', 4), pickOf('claude', 'haiku', 'low', 3)],
    [card('fable', 4, 1), card('sonnet', 2, 2), card('haiku', 1, 3)]);
  const measured = {
    'review|claude|fable|high': { n: 3, tokens: 8.6e6, durationMs: 34 * 60000 },
    'review|claude|sonnet|low': { n: 3, tokens: 0.6e6, durationMs: 60000 },
    'review|claude|haiku|low': { n: 3, tokens: 0.1e6, durationMs: 30000 },
  };
  const rec = m.recommend(matrix, 'review', { measured });
  assert.deepStrictEqual(rec.picks.map((p) => p.model), ['sonnet', 'fable', 'haiku']);
  assert.deepStrictEqual(rec.picks.map((p) => p.goodEnough), [true, true, false]);
  assert.deepStrictEqual(rec.picks[0].measured, measured['review|claude|sonnet|low']);
});

test('without measures the static cost then speed order the good-enough picks', () => {
  const matrix = valueMatrix(
    [pickOf('claude', 'opus', 'high', 5), pickOf('claude', 'sonnet', 'high', 4), pickOf('codex', 'gpt-6-sol', 'medium', 4), pickOf('claude', 'haiku', 'low', 2)],
    [card('opus', 3, 1), card('sonnet', 2, 2), card('gpt-6-sol', 2, 3, 'codex'), card('haiku', 1, 3)]);
  const rec = m.recommend(matrix, 'review');
  assert.deepStrictEqual(rec.picks.map((p) => p.model), ['gpt-6-sol', 'sonnet', 'opus', 'haiku']);
  assert.strictEqual(rec.picks.find((p) => p.model === 'sonnet').measured, null);
});

test('a measurement below the minimum does not replace the static cost', () => {
  const matrix = valueMatrix([pickOf('claude', 'sonnet', 'low', 4), pickOf('claude', 'opus', 'low', 4)], [card('sonnet', 2, 2), card('opus', 3, 1)]);
  const measured = { 'review|claude|opus|low': { n: 1, tokens: 1, durationMs: 1000 } };
  assert.deepStrictEqual(m.recommend(matrix, 'review', { measured }).picks.map((p) => p.model), ['sonnet', 'opus']);
});

test('unavailable providers stay last even when cheap and good enough, and each provider keeps its own order', () => {
  const matrix = valueMatrix(
    [pickOf('claude', 'opus', 'high', 5), pickOf('claude', 'sonnet', 'high', 4), pickOf('codex', 'gpt-6-luna', 'low', 4), pickOf('codex', 'gpt-6-sol', 'high', 5)],
    [card('opus', 3, 1), card('sonnet', 2, 2), card('gpt-6-luna', 1, 3, 'codex'), card('gpt-6-sol', 2, 2, 'codex')]);
  const off = m.recommend(matrix, 'review', { available: { codex: false } });
  assert.deepStrictEqual(off.picks.map((p) => p.model), ['sonnet', 'opus', 'gpt-6-luna', 'gpt-6-sol']);
  const on = m.recommend(matrix, 'review');
  assert.deepStrictEqual(on.picks.filter((p) => p.provider === 'codex').map((p) => p.model), ['gpt-6-luna', 'gpt-6-sol']);
});

test('an unmeasured dear pick does not pass ahead of a measured cheap one, and takes the category median tokens', () => {
  const matrix = valueMatrix(
    [pickOf('claude', 'opus', 'high', 4), pickOf('claude', 'haiku', 'low', 4), pickOf('claude', 'sonnet', 'low', 4)],
    [card('opus', 3, 1), card('haiku', 1, 3), card('sonnet', 2, 2)]);
  const measured = {
    'review|claude|haiku|low': { n: 3, tokens: 0.2e6, durationMs: 30000 },
    'review|claude|sonnet|low': { n: 3, tokens: 0.4e6, durationMs: 60000 },
  };
  const rec = m.recommend(matrix, 'review', { measured });
  assert.deepStrictEqual(rec.picks.map((p) => p.model), ['haiku', 'sonnet', 'opus']);
  assert.ok(Math.abs(rec.picks.find((p) => p.model === 'opus').expectedCost - 0.9) < 1e-9);
});

test('an unmeasured pick of a category without any measure keeps the static order', () => {
  const matrix = valueMatrix([pickOf('claude', 'opus', 'high', 4), pickOf('claude', 'haiku', 'low', 4)], [card('opus', 3, 1), card('haiku', 1, 3)]);
  assert.deepStrictEqual(m.recommend(matrix, 'review').picks.map((p) => p.model), ['haiku', 'opus']);
});

const rated = (category, model, effort, agent, tokens, durationMs, extra = {}) => ({ at: 1, master: 'm1', job: 1, agent, category, provider: 'claude', model, effort, score: 4, ...(tokens != null ? { tokens } : {}), ...(durationMs != null ? { durationMs } : {}), ...extra });

test('aggregateMeasured merges the measures kept in ratings with the store rows, each agent once', () => {
  const rows = [
    row('review', 'sonnet', 'low', 100, 60000, { id: 'w1', master: 'm1', job: 1 }),
    row('review', 'sonnet', 'low', 300, 120000, { id: 'w2', master: 'm1', job: 1 }),
    row('review', 'sonnet', 'low', 500, 180000, { id: 'w1', master: 'm2', job: 1 }),
  ];
  const ratings = [rated('review', 'sonnet', 'low', 'w1', 110, 70000), rated('review', 'sonnet', 'low', 'w9', 900, 240000)];
  const out = m.aggregateMeasured(rows, ratings)['review|claude|sonnet|low'];
  assert.deepStrictEqual(out, { n: 4, tokens: 400, durationMs: 150000 });
});

test('a rated agent keeps its store measure when the rating recorded none, and a rating alone is measured', () => {
  const rows = [row('review', 'opus', 'high', 100, 60000, { id: 'w1', master: 'm1', job: 1 })];
  assert.strictEqual(m.aggregateMeasured(rows, [rated('review', 'opus', 'high', 'w1')])['review|claude|opus|high'].n, 1);
  assert.strictEqual(m.aggregateMeasured(rows, [rated('review', 'opus', 'high', 'w1')])['review|claude|opus|high'].tokens, 100);
  const alone = m.aggregateMeasured([], [rated('review', 'haiku', 'low', 'w3', 40, null)]);
  assert.deepStrictEqual(alone['review|claude|haiku|low'], { n: 1, tokens: 40, durationMs: null });
  assert.deepStrictEqual(m.aggregateMeasured([], [rated('review', 'haiku', 'low', 'w3')]), {});
});

test('billedTokens weighs cache reads like they are billed, and ratingMeasure records only what is known', () => {
  assert.strictEqual(m.billedTokens({ input: 100, cacheWrite: 10, cacheRead: 1000, output: 50 }), 260);
  assert.deepStrictEqual(m.ratingMeasure({ totals: { input: 1, cacheWrite: 0, cacheRead: 0, output: 1 }, startedAt: 1000, workEndedAt: 4000 }), { tokens: 2, durationMs: 3000 });
  assert.deepStrictEqual(m.ratingMeasure({ startedAt: 1000, workEndedAt: null }), {});
});

test('store durations run to the last finished turn, and a rating counts the same agent once whatever its duration source', () => {
  const rows = [row('review', 'sonnet', 'low', 100, null, { id: 'w1', master: 'm1', job: 1, workEndedAt: 61000, totals: { input: 0, cacheWrite: 0, cacheRead: 1000, output: 0 } })];
  assert.deepStrictEqual(m.aggregateMeasured(rows)['review|claude|sonnet|low'], { n: 1, tokens: 100, durationMs: 60000 });
  const both = m.aggregateMeasured(rows, [rated('review', 'sonnet', 'low', 'w1', 90, 59000)]);
  assert.deepStrictEqual(both['review|claude|sonnet|low'], { n: 1, tokens: 90, durationMs: 59000 });
});

test('the latest rating of an agent counts once', () => {
  const twice = m.aggregateMeasured([], [rated('review', 'opus', 'high', 'w1', 100, 1000, { at: 1 }), rated('review', 'opus', 'high', 'w1', 300, 3000, { at: 2 })]);
  assert.deepStrictEqual(twice['review|claude|opus|high'], { n: 1, tokens: 300, durationMs: 3000 });
});

test('a quality-first category orders by quality, then quota cost, then duration, unavailable providers last', () => {
  const matrix = { models: [card('opus', 3, 1), card('sonnet', 2, 2), card('gpt-6-astra', 3, 1, 'codex'), card('haiku', 1, 3)], categories: [{ id: 'delicate', rankBy: 'quality', label: 'Sensible', picks: [
    pickOf('claude', 'sonnet', 'high', 4), pickOf('claude', 'opus', 'high', 5), pickOf('claude', 'haiku', 'high', 4), pickOf('codex', 'gpt-6-astra', 'high', 5)] }] };
  assert.deepStrictEqual(m.recommend(matrix, 'delicate').picks.map((p) => p.model), ['opus', 'gpt-6-astra', 'haiku', 'sonnet']);
  assert.deepStrictEqual(m.recommend(matrix, 'delicate', { available: { codex: false } }).picks.map((p) => p.model), ['opus', 'haiku', 'sonnet', 'gpt-6-astra']);
  const valueRanked = { ...matrix, categories: [{ ...matrix.categories[0], rankBy: undefined }] };
  assert.strictEqual(m.recommend(valueRanked, 'delicate').picks[0].model, 'haiku');
});

test('a pick measured at zero tokens is not measured and does not pass ahead as free', () => {
  const matrix = valueMatrix([pickOf('claude', 'opus', 'low', 4), pickOf('claude', 'sonnet', 'low', 4)], [card('opus', 3, 1), card('sonnet', 2, 2)]);
  const measured = { 'review|claude|opus|low': { n: 3, tokens: 0, durationMs: 1000 }, 'review|claude|sonnet|low': { n: 3, tokens: 1e6, durationMs: 60000 } };
  assert.deepStrictEqual(m.recommend(matrix, 'review', { measured }).picks.map((p) => p.model), ['sonnet', 'opus']);
  assert.deepStrictEqual(m.aggregateMeasured([], [rated('review', 'opus', 'low', 'w1', 0, 1000)]), {});
});

test('one measure per obs: outcome records and store rows of the same agent count once, the latest record wins', () => {
  const rows = [
    row('review', 'sonnet', 'low', 100, 60000, { id: 'w1', obs: 'a', master: 'm1', job: 1 }),
    row('review', 'sonnet', 'low', 300, 120000, { id: 'w2', obs: 'b', master: 'm1', job: 1 }),
    row('review', 'sonnet', 'low', 500, 180000, { id: 'w1', obs: 'c', master: 'm2', job: 1 }),
  ];
  const outcome = (obs, tokens, durationMs, at) => ({ obs, at, category: 'review', provider: 'claude', model: 'sonnet', effort: 'low', tokens, durationMs });
  const out = m.aggregateMeasured(rows, [outcome('a', 90, 50000, 1), outcome('a', 110, 70000, 2), outcome('z', 900, 240000, 1)])['review|claude|sonnet|low'];
  assert.deepStrictEqual(out, { n: 4, tokens: 400, durationMs: 150000 });
});

test('a legacy rating and the store row of the same agent count once even when the row carries an obs', () => {
  const rows = [row('review', 'sonnet', 'low', 100, 60000, { id: 'w1', obs: 'a', master: 'm1', job: 1 })];
  const out = m.aggregateMeasured(rows, [rated('review', 'sonnet', 'low', 'w1', 110, 70000)])['review|claude|sonnet|low'];
  assert.deepStrictEqual(out, { n: 1, tokens: 110, durationMs: 70000 });
});

test('the evidence sent to the page is bounded: score, weight, counters, indicators and the last 3 observations', () => {
  const observations = [...Array.from({ length: 40 }, (_, i) => ({ obs: `o${i}`, score: 80, level: 'audited' })), { obs: 'out', level: 'outcome' }, { obs: 'old', level: 'legacy' }];
  const full = { key: 'k', category: 'review', provider: 'claude', model: 'sonnet', effort: 'low', S: 81, V: 6, confidence: 'solide', observations, legacy: [4, 5], outcomes: { 'as-is': 2 }, medianRounds: 1, ranks: [{ rank: 1, of: 2 }], legacyAvg: 82 };
  const slim = m.slimEvidence(full);
  assert.deepStrictEqual(slim.observations.map((o) => o.obs), ['o37', 'o38', 'o39']);
  assert.deepStrictEqual([slim.S, slim.V, slim.confidence, slim.observationCount - 2, slim.legacyCount, slim.legacyAvg, slim.medianRounds], [81, 6, 'solide', 40, 2, 82, 1]);
  assert.ok(!('legacy' in slim));
  assert.strictEqual(m.slimEvidence(null), null);
  const matrix = valueMatrix([pickOf('claude', 'sonnet', 'low', 4)], [card('sonnet', 2, 2)]);
  const pick = m.recommend(matrix, 'review', { scores: { 'review|claude|sonnet|low': full } }).picks[0];
  assert.strictEqual(pick.evidence.observations.length, 3);
  assert.ok(!('rank' in pick));
});

test('an unmeasured pick takes the median duration of the category, so it is not favoured by its static speed', () => {
  const matrix = valueMatrix([pickOf('claude', 'opus', 'high', 4), pickOf('claude', 'haiku', 'low', 4), pickOf('claude', 'sonnet', 'low', 4)], [card('opus', 2, 1), card('haiku', 2, 3), card('sonnet', 2, 2)]);
  const measured = {
    'review|claude|haiku|low': { n: 3, tokens: 1e6, durationMs: 40 * 60000 },
    'review|claude|sonnet|low': { n: 3, tokens: 1e6, durationMs: 20 * 60000 },
  };
  const rec = m.recommend(matrix, 'review', { measured });
  assert.deepStrictEqual(rec.picks.map((p) => [p.model, p.expectedMinutes]), [['sonnet', 20], ['opus', 30], ['haiku', 40]]);
});

test('addVerdicts stores by id, replaces an outcome, counts only what the retention kept', () => {
  const f = (obs, n = 1) => ({ id: `${obs}:F${n}`, type: 'finding', judge: { obs: 'j' }, target: { obs }, severity: 'to-fix' });
  const o = (value) => ({ id: 't:outcome', type: 'outcome', pick: { obs: 't' }, outcome: value });
  const first = m.addVerdicts([], [f('a'), o(null), { type: 'finding' }]);
  assert.strictEqual(first.added, 2);
  assert.strictEqual(m.addVerdicts(first.records, [f('a')]).added, 0);
  const changed = m.addVerdicts(first.records, [o('fixed')]);
  assert.deepStrictEqual([changed.added, changed.records.find((r) => r.id === 't:outcome').outcome], [1, 'fixed']);
  const capped = m.addVerdicts([f('a'), f('b')], [f('c'), f('d')], 2);
  assert.deepStrictEqual(capped.records.map((r) => r.target.obs), ['c', 'd']);
  assert.strictEqual(capped.added, 2);
  assert.strictEqual(m.addVerdicts([f('a')], [f('b'), f('c')], 1).added, 1, 'a record dropped by the retention is not counted');
  assert.deepStrictEqual(m.addVerdicts('x', undefined).records, []);
});

test('cleanCoverage ignores corrupted counters', () => {
  assert.deepStrictEqual(m.cleanCoverage({ launches: 'x', credits: -1, spent: 2.5 }), { launches: 0, credits: 0, spent: 0 });
  assert.deepStrictEqual(m.cleanCoverage({ launches: 7, credits: 1, spent: 3 }), { launches: 7, credits: 1, spent: 3 });
  assert.deepStrictEqual(m.cleanCoverage(null), { launches: 0, credits: 0, spent: 0 });
});

test('the quality band is anchored on the best available pick, not on an unavailable one', () => {
  const matrix = { models: [card('opus', 3, 1), card('sonnet', 2, 2), card('gpt-6-astra', 3, 1, 'codex')], categories: [{ id: 'delicate', rankBy: 'quality', label: 'S', picks: [pickOf('claude', 'opus', 'high', 5), pickOf('claude', 'sonnet', 'high', 4), pickOf('codex', 'gpt-6-astra', 'high', 5)] }] };
  const scores = scoresOf(evidence('delicate', 'gpt-6-astra', 'high', 99, 6, { provider: 'codex' }), evidence('delicate', 'opus', 'high', 78, 6), evidence('delicate', 'sonnet', 'high', 76, 6));
  const rec = m.recommend(matrix, 'delicate', { scores, available: { codex: false } });
  assert.deepStrictEqual(rec.picks.map((p) => p.model), ['sonnet', 'opus', 'gpt-6-astra']);
});
