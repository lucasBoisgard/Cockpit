// Relevance matrix of providers × models × efforts per kind of task, without I/O. The versioned default
// (server/data/model-matrix.json) is overlaid by the maintainer's published edits, then by the user's local edits; masters rate their agents, and the
// observed average weighs on the ranking as ratings accumulate.
const providers = require('./providers');

const PRIOR_WEIGHT = 2;
const MAX_PICKS = 8;
const RATINGS_MAX = 2000;
// A combination the masters used outside the matrix shows up once rated this often, starting from a neutral prior.
const OFF_MATRIX_MIN = 2;
const OFF_MATRIX_PRIOR = 3;

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

function validateRating(input = {}) {
  const score = Number(input.score);
  if (!Number.isInteger(score) || score < 1 || score > 5) return { error: 'Note entre 1 et 5.' };
  return { score, note: clip(input.note, 300) };
}

function addRating(ratings, rating) {
  return [...(ratings || []), rating].slice(-RATINGS_MAX);
}

// Observed results per (category, provider, model, effort): average, count and the latest notes.
function aggregateRatings(ratings = []) {
  const out = {};
  for (const r of ratings) {
    if (!r.category) continue;
    const k = keyOf(r.category, r);
    const a = out[k] || (out[k] = { category: r.category, provider: r.provider, model: r.model, effort: r.effort || null, sum: 0, n: 0, notes: [] });
    a.sum += r.score;
    a.n += 1;
    if (r.note) a.notes = [{ at: r.at, score: r.score, note: r.note, agent: r.agent }, ...a.notes].slice(0, 3);
  }
  for (const a of Object.values(out)) a.avg = Math.round((a.sum / a.n) * 10) / 10;
  return out;
}

// The reference score counts as PRIOR_WEIGHT ratings, so a few observations move it and many dominate it.
function blended(score, observed) {
  return observed?.n ? Math.round(((score * PRIOR_WEIGHT + observed.sum) / (PRIOR_WEIGHT + observed.n)) * 10) / 10 : score;
}

function recommend(matrix, categoryId, { available = {}, ratings = {} } = {}) {
  const category = matrix.categories.find((c) => c.id === categoryId);
  if (!category) return null;
  const picks = category.picks.map((p) => {
    const observed = ratings[keyOf(category.id, p)] || null;
    return { ...p, observed: observed ? { avg: observed.avg, n: observed.n, notes: observed.notes } : null, rank: blended(p.score, observed), available: available[p.provider] !== false };
  });
  const listed = new Set(picks.map((p) => keyOf(category.id, p)));
  for (const [key, o] of Object.entries(ratings)) {
    if (o.category !== category.id || !o.model || listed.has(key) || o.n < OFF_MATRIX_MIN) continue;
    picks.push({ provider: o.provider, model: o.model, effort: o.effort, score: null, why: 'Observé hors matrice : choisi par des maîtres sans figurer dans la catégorie.', offMatrix: true,
      observed: { avg: o.avg, n: o.n, notes: o.notes }, rank: blended(OFF_MATRIX_PRIOR, o), available: available[o.provider] !== false });
  }
  picks.sort((a, b) => (b.available - a.available) || (b.rank - a.rank) || ((b.score || 0) - (a.score || 0)));
  return { ...category, picks };
}

// Every available pick worth using (score >= minScore) needs `target` ratings before calibration is complete.
function calibrationCoverage(matrix, ratings = {}, { available = {}, target = 2, minScore = 3 } = {}) {
  const missing = [];
  let total = 0;
  for (const c of matrix.categories) {
    for (const p of c.picks) {
      if (available[p.provider] === false || !(p.score >= minScore)) continue;
      total += 1;
      const n = ratings[keyOf(c.id, p)]?.n || 0;
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

module.exports = { calibrationCoverage, rescorePicks, PRIOR_WEIGHT, OFF_MATRIX_MIN, OFF_MATRIX_PRIOR, keyOf, ratingKey, applyEdits, combineRatings, mergeMatrix, validateCategory, validateRating, addRating, aggregateRatings, blended, recommend };
