const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('../config');
const { loadStore, saveStore } = require('../io/store');
const core = require('../core/matrix');
const providerCore = require('../core/providers');
const { codexInfo, codexCatalog } = require('./providers');

const DEFAULT_FILE = path.join(ROOT, 'server', 'data', 'model-matrix.json');
const OVERRIDES = 'worktree-matrix.json';
const RATINGS = 'worktree-matrix-ratings.json';

function defaults() {
  try {
    return JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8'));
  } catch {
    return { categories: [], models: [] };
  }
}

const merged = () => core.mergeMatrix(defaults(), loadStore(OVERRIDES, {}));
const categoryIds = () => merged().categories.map((c) => c.id);

// The matrix with, per category, the picks ranked by reference score and observed ratings.
async function getMatrix() {
  const matrix = merged();
  const codex = await codexInfo();
  const available = { claude: true, codex: codex.installed && codex.loggedIn };
  const ratings = core.aggregateRatings(loadStore(RATINGS, []));
  return {
    note: matrix.note,
    available,
    models: matrix.models,
    categories: matrix.categories.map((c) => core.recommend(matrix, c.id, { available, ratings })),
    recent: loadStore(RATINGS, []).slice(-30).reverse(),
  };
}

async function saveCategory(body = {}) {
  const checked = core.validateCategory(body, { claude: providerCore.CLAUDE_MODELS, codex: await codexCatalog() });
  if (checked.error) return checked;
  const overrides = loadStore(OVERRIDES, {});
  overrides.categories = { ...(overrides.categories || {}), [checked.category.id]: { ...checked.category, editedAt: Date.now() } };
  saveStore(OVERRIDES, overrides);
  return { ok: true };
}

function resetCategory({ id }) {
  const overrides = loadStore(OVERRIDES, {});
  if (!overrides.categories?.[id]) return { error: 'Cette catégorie n’a pas de réglage local.' };
  delete overrides.categories[id];
  saveStore(OVERRIDES, overrides);
  return { ok: true };
}

function recordRating(rating) {
  saveStore(RATINGS, core.addRating(loadStore(RATINGS, []), rating));
}

module.exports = { getMatrix, saveCategory, resetCategory, recordRating, categoryIds };
