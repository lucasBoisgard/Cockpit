// Relevance matrix of providers × models × efforts per kind of task, without I/O. The versioned default
// (server/data/model-matrix.json) is overlaid by the maintainer's published edits, then by the user's local edits;
// the score out of 100 of a pick comes from the verdicts of verifying agents (verdicts.js), the reference being its prior.
const providers = require('./providers');
const verdicts = require('./verdicts');

const MAX_PICKS = 8;
const RATINGS_MAX = 2000;
// A combination the masters used outside the matrix shows up once verifiers have covered it with this much weight.
const OFF_MATRIX_MIN_WEIGHT = 1;
const { GOOD_ENOUGH, COVERAGE_TARGET: COVERED_AT } = verdicts;
// Measured medians count from this many agents; below it the model's static cost and speed stand in.
const MIN_MEASURED = 2;
const DEFAULT_TIER = 2;
// Tokens assumed, in millions, for a pick without measurement when its category has none either.
const ASSUMED_MTOK = 0.5;

const keyOf = (category, p) => `${category}|${p.provider}|${p.model}|${p.effort || ''}`;
const clip = (text, max) => String(text ?? '').trim().slice(0, max);

// The maintainer's published edits replace a category of the hand-written default, or add one, before any local edit.
function applyEdits(defaults = {}, edits = {}) {
  const changed = edits.categories || {};
  const categories = (defaults.categories || []).map((c) => (changed[c.id] ? { ...c, ...changed[c.id], id: c.id, source: 'published' } : c));
  for (const [id, c] of Object.entries(changed)) if (!categories.some((x) => x.id === id)) categories.push({ ...c, id, source: 'published' });
  return { ...defaults, categories };
}

const list = (value) => (Array.isArray(value) ? value : []);
const ratingKey = (r) => [r.at, r.master, r.agent, r.category, r.provider, r.model, r.effort].join('|');

// Published ratings and this machine's own, without duplicates (a machine that held a rating before it was
// published must not count it twice), oldest first.
function combineRatings(shared, local) {
  const byKey = new Map();
  for (const r of [...list(shared), ...list(local)]) byKey.set(ratingKey(r), r);
  return [...byKey.values()].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-RATINGS_MAX);
}

const sameContent = (a, b) => JSON.stringify([a.label, a.description || '', a.picks || []]) === JSON.stringify([b.label, b.description || '', b.picks || []]);

// Local edits replace a category's label, description and picks; a local category with a new id is added. A local
// edit equal to the category it replaces is ignored, so that it does not hide later published changes.
function mergeMatrix(defaults = {}, overrides = {}) {
  const local = overrides.categories || {};
  const categories = (defaults.categories || []).map((c) => (local[c.id] && !sameContent(local[c.id], c) ? { ...c, ...local[c.id], id: c.id, source: 'local' } : { ...c, source: c.source || 'default' }));
  for (const [id, c] of Object.entries(local)) if (!categories.some((x) => x.id === id)) categories.push({ ...c, id, source: 'local' });
  return { version: defaults.version || 1, note: defaults.note || '', models: defaults.models || [], categories };
}

// catalogs: { claude: [ids], codex: [{ id, efforts }] } — a pick must be a model and effort its provider offers.
function validateCategory(input = {}, catalogs = {}) {
  const id = clip(input.id, 40);
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(id)) return { error: 'Identifiant de catégorie invalide (minuscules, chiffres, tirets).' };
  const label = clip(input.label, 60);
  if (!label) return { error: 'Donne un nom à la catégorie.' };
  const picks = Array.isArray(input.picks) ? input.picks : [];
  if (picks.length > MAX_PICKS) return { error: `${MAX_PICKS} choix au plus par catégorie.` };
  const out = [];
  for (const p of picks) {
    const checked = providers.validateSettings(p.provider, { model: p.model, effort: p.effort }, catalogs[p.provider]);
    if (checked.error) return checked;
    if (!checked.model) return { error: 'Chaque choix a besoin d’un modèle.' };
    const score = Number(p.score);
    if (!Number.isInteger(score) || score < 1 || score > 5) return { error: 'Score entre 1 et 5.' };
    if (out.some((o) => o.provider === checked.provider && o.model === checked.model && o.effort === checked.effort)) return { error: `${checked.model} · ${checked.effort || 'défaut'} est en double.` };
    out.push({ provider: checked.provider, model: checked.model, effort: checked.effort, score, why: clip(p.why, 200) });
  }
  return { category: { id, label, description: clip(input.description, 200), picks: out } };
}

// Legacy ratings (the masters' 1-5 opinions, frozen: nothing writes them any more) as the records the scoring reads;
// their weight is capped by the scoring, so ratings that older installs keep publishing change little.
const legacyRatings = (ratings = []) => ratings.filter((r) => r.category);

const median = (values) => {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

const legacyKey = (r) => `${r.master}|${r.job}|${r.agent ?? r.id}`;
// Cache reads are billed about a tenth of a fresh token: counting them in full would make a model that re-reads its
// context look dearer than its quota weight.
const CACHE_READ_WEIGHT = 0.1;
const billedTokens = (t) => Math.round(t.input + t.cacheWrite + t.output + CACHE_READ_WEIGHT * t.cacheRead);

// What a rating records of the agent it rates, when known.
function ratingMeasure({ totals, startedAt, workEndedAt } = {}) {
  return { ...(totals ? { tokens: billedTokens(totals) } : {}), ...(startedAt && workEndedAt > startedAt ? { durationMs: workEndedAt - startedAt } : {}) };
}

// Past agents per (category, provider, model, effort): how many were measured, their median billed tokens and duration.
// Each agent is counted once, keyed by its `obs` (legacy ratings, which have none, by master, job and agent): the
// measures kept in outcome records and legacy ratings first (they outlive the orchestration store; the latest one
// of an agent counts), then the store rows of agents not covered that way. An agent without a category or without
// tokens is not measured.
function aggregateMeasured(rows = [], records = []) {
  const latest = new Map();
  records.forEach((r, i) => {
    if (!r.category || !(r.tokens > 0)) return;
    const key = r.obs || (r.agent && r.master ? legacyKey(r) : `#${i}`);
    if (!latest.has(key) || (r.at || 0) >= (latest.get(key).at || 0)) latest.set(key, r);
  });
  const counted = new Set(latest.keys());
  const items = [...latest.values()].map((r) => ({ key: keyOf(r.category, r), tokens: r.tokens, durationMs: r.durationMs > 0 ? r.durationMs : null }));
  for (const r of rows) {
    if (r.role === 'master' || r.shared || !r.kind || !r.totals || !(billedTokens(r.totals) > 0) || (r.obs && counted.has(r.obs)) || (r.id && counted.has(legacyKey(r)))) continue;
    if (r.obs) counted.add(r.obs);
    items.push({ key: keyOf(r.kind, r), tokens: billedTokens(r.totals), durationMs: r.startedAt && r.workEndedAt > r.startedAt ? r.workEndedAt - r.startedAt : null });
  }
  const groups = {};
  for (const i of items) (groups[i.key] || (groups[i.key] = [])).push(i);
  const out = {};
  for (const [k, list] of Object.entries(groups)) {
    const durations = list.map((i) => i.durationMs).filter((d) => d != null);
    out[k] = { n: list.length, tokens: median(list.map((i) => i.tokens)), durationMs: durations.length ? median(durations) : null };
  }
  return out;
}

const cardOf = (models, p) => models.find((m) => m.provider === p.provider && m.model === p.model) || {};

const isMeasured = (p) => p.measured && p.measured.n >= MIN_MEASURED && p.measured.tokens > 0;

// Quota cost of a pick, higher = dearer: its measured median billed tokens times the model's quota weight (how fast it
// fills the usage limit per token); an unmeasured pick takes the median of the category's measured picks
// (`typicalTokens`, in millions) so it is not favoured.
function expectedCost(p, card, typicalTokens) {
  return (isMeasured(p) ? p.measured.tokens / 1e6 : typicalTokens) * (card.cost ?? DEFAULT_TIER);
}

// Duration in minutes when measured, else the median of the category's measured picks (like the tokens) so that an
// unmeasured pick is not favoured; without any measure in the category, 4 - speed (3 = fast) orders by static speed.
function expectedDuration(p, card, typicalMinutes) {
  if (isMeasured(p) && p.measured.durationMs != null) return p.measured.durationMs / 60000;
  return typicalMinutes ?? 4 - (card.speed ?? DEFAULT_TIER);
}

const LAST_OBSERVATIONS = 3;

// What the page needs of a pick's verdicts, bounded whatever the number of observations: the score, the weight and
// confidence, the counters and indicators, and the last verified observations (outcomes and legacy ratings stay in the counters).
function slimEvidence(e) {
  if (!e) return null;
  const { observations = [], legacy = [], ...rest } = e;
  const { findings, records, ...kept } = rest;
  return { ...kept, observationCount: observations.length, legacyCount: legacy.length, observations: observations.filter((o) => o.level !== 'outcome' && o.level !== 'legacy').slice(-LAST_OBSERVATIONS) };
}

// `scores`: per pick key, the entry of verdicts.pickScores ({ category, provider, model, effort, S, V, confidence, ... }).
// A pick without evidence keeps its reference (1-5 score through the legacy map) as its score out of 100.
function recommend(matrix, categoryId, { available = {}, scores = {}, measured = {} } = {}) {
  const category = matrix.categories.find((c) => c.id === categoryId);
  if (!category) return null;
  const shape = (p, ref) => {
    const key = keyOf(category.id, p);
    const evidence = slimEvidence(scores[key]);
    const quality = Number.isFinite(evidence?.S) ? evidence.S : ref;
    return { ...p, key, evidence, quality, verified: evidence?.V || 0, confidence: evidence?.confidence || verdicts.confidence(0), measured: measured[key] || null, available: available[p.provider] !== false };
  };
  const picks = category.picks.map((p) => shape(p, verdicts.refScore(p.score)));
  const listed = new Set(picks.map((p) => p.key));
  for (const [key, o] of Object.entries(scores)) {
    if (o.category !== category.id || !o.model || listed.has(key) || !(o.V >= OFF_MATRIX_MIN_WEIGHT)) continue;
    picks.push(shape({ provider: o.provider, model: o.model, effort: o.effort || null, score: null, why: 'Observé hors matrice : choisi par des maîtres sans figurer dans la catégorie.', offMatrix: true }, verdicts.refScore(null)));
  }
  const models = matrix.models || [];
  const typicalTokens = (median(picks.filter(isMeasured).map((p) => p.measured.tokens)) ?? ASSUMED_MTOK * 1e6) / 1e6;
  const typicalMinutes = median(picks.filter((p) => isMeasured(p) && p.measured.durationMs != null).map((p) => p.measured.durationMs / 60000));
  for (const p of picks) {
    const card = cardOf(models, p);
    p.goodEnough = p.quality >= GOOD_ENOUGH;
    p.expectedCost = expectedCost(p, card, typicalTokens);
    p.expectedMinutes = expectedDuration(p, card, typicalMinutes);
  }
  const orderOf = (group) => verdicts.orderPicks(group.map((p) => ({ key: p.key, S: p.quality, quotaCost: p.expectedCost, durationMs: p.expectedMinutes })), category.rankBy);
  const byKey = new Map(picks.map((p) => [p.key, p]));
  const ranked = [...orderOf(picks.filter((p) => p.available)), ...orderOf(picks.filter((p) => !p.available))].map((o) => byKey.get(o.key));
  return { ...category, picks: ranked };
}

const byId = (...lists) => [...new Map(lists.flat().filter((r) => r && r.id).map((r) => [r.id, r])).values()];

// Stores incoming verdict records among the stored ones by id (a later one replaces an earlier one), within the
// retention; `added` counts the incoming records that are new or changed and survived the retention.
function addVerdicts(stored = [], incoming = [], max) {
  const known = new Map(byId(stored).map((r) => [r.id, JSON.stringify(r)]));
  const fresh = byId(incoming).filter((r) => known.get(r.id) !== JSON.stringify(r));
  if (!fresh.length) return { records: byId(stored), added: 0 };
  const records = verdicts.retain(byId(stored, fresh), max);
  const kept = new Set(records.map((r) => r.id));
  return { records, added: fresh.filter((r) => kept.has(r.id)).length };
}

// A coverage file that was hand-edited or truncated falls back to zeros instead of poisoning the counters.
function cleanCoverage(raw) {
  const n = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
  return { launches: n(raw?.launches), credits: n(raw?.credits), spent: n(raw?.spent) };
}

// Every available pick worth using (reference >= minScore) must have been verified with COVERED_AT weight before
// calibration is complete.
function calibrationCoverage(matrix, scores = {}, { available = {}, target = COVERED_AT, minScore = 3 } = {}) {
  const missing = [];
  let total = 0;
  for (const c of matrix.categories) {
    for (const p of c.picks) {
      if (available[p.provider] === false || !(p.score >= minScore)) continue;
      total += 1;
      const n = scores[keyOf(c.id, p)]?.V || 0;
      if (n < target) missing.push({ category: c.id, provider: p.provider, model: p.model, effort: p.effort || null, n });
    }
  }
  missing.sort((a, b) => a.category.localeCompare(b.category) || a.n - b.n);
  return { target, total, done: total - missing.length, missing, complete: missing.length === 0 };
}

// Sets the reference score and reason of a pick, adding it when the category does not list it yet.
function rescorePicks(picks = [], target = {}) {
  const same = (p) => p.provider === target.provider && p.model === target.model && (p.effort || null) === (target.effort || null);
  const entry = { provider: target.provider, model: target.model, effort: target.effort || null, score: target.score, why: target.why };
  if (picks.some(same)) return { picks: picks.map((p) => (same(p) ? { ...p, ...entry } : p)) };
  if (picks.length >= MAX_PICKS) return { error: `La catégorie a déjà ${MAX_PICKS} choix : retire-en un avant d’ajouter ${target.model}.` };
  return { picks: [...picks, entry] };
}

module.exports = { calibrationCoverage, rescorePicks, OFF_MATRIX_MIN_WEIGHT, COVERED_AT, addVerdicts, cleanCoverage, slimEvidence, keyOf, ratingKey, applyEdits, combineRatings, mergeMatrix, validateCategory, legacyRatings, aggregateMeasured, ratingMeasure, billedTokens, CACHE_READ_WEIGHT, recommend, GOOD_ENOUGH, MIN_MEASURED };
