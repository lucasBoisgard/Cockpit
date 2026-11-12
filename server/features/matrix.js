const fs = require('node:fs');
const path = require('node:path');
const { ROOT, MATRIX_MAINTAINER } = require('../config');
const { readJson, loadStore, saveStore } = require('../io/store');
const core = require('../core/matrix');
const providerCore = require('../core/providers');
const { codexInfo, codexCatalog } = require('./providers');

const DATA = path.join(ROOT, 'server', 'data');
const DEFAULT_FILE = path.join(DATA, 'model-matrix.json');
// Versioned in the repo and written only by the maintainer's cockpit (`matrix.maintainer` in cockpit.config.json):
// every other install starts from them and keeps its own learning in ~/.claude.
const SHARED_EDITS_FILE = path.join(DATA, 'model-matrix-edits.json');
const SHARED_RATINGS_FILE = path.join(DATA, 'model-ratings.json');
const OVERRIDES = 'worktree-matrix.json';
const RATINGS = 'worktree-matrix-ratings.json';
const CALIBRATION_TARGET = 2;

function defaults() {
  try {
    return JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8'));
  } catch {
    return { categories: [], models: [] };
  }
}

function writeRepoFile(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

const objectOr = (value, fallback) => (value && typeof value === 'object' && Array.isArray(value) === Array.isArray(fallback) ? value : fallback);
const sharedEdits = () => objectOr(readJson(SHARED_EDITS_FILE), {});
const sharedRatings = () => objectOr(readJson(SHARED_RATINGS_FILE), []);
const editsText = (edits) => `${JSON.stringify(edits, null, 2)}\n`;
// One rating per line, so that a new rating is a one-line diff.
const ratingsText = (ratings) => `[\n${ratings.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`;
const saveSharedEdits = (edits) => writeRepoFile(SHARED_EDITS_FILE, editsText(edits));
const saveSharedRatings = (ratings) => writeRepoFile(SHARED_RATINGS_FILE, ratingsText(ratings));

const editsStore = () => (MATRIX_MAINTAINER ? sharedEdits() : loadStore(OVERRIDES, {}));
const saveEdits = (edits) => (MATRIX_MAINTAINER ? saveSharedEdits(edits) : saveStore(OVERRIDES, edits));

const merged = () => core.mergeMatrix(core.applyEdits(defaults(), sharedEdits()), MATRIX_MAINTAINER ? {} : loadStore(OVERRIDES, {}));
const allRatings = () => core.combineRatings(sharedRatings(), MATRIX_MAINTAINER ? [] : loadStore(RATINGS, []));
const categoryIds = () => merged().categories.map((c) => c.id);

// The matrix with, per category, the picks ranked by reference score and observed ratings.
async function getMatrix() {
  const matrix = merged();
  const codex = await codexInfo();
  const available = { claude: true, codex: codex.installed && codex.loggedIn };
  const all = allRatings();
  return {
    note: matrix.note,
    available,
    maintainer: MATRIX_MAINTAINER,
    models: matrix.models,
    categories: matrix.categories.map((c) => core.recommend(matrix, c.id, { available, ratings: core.aggregateRatings(all) })),
    recent: all.slice(-30).reverse(),
  };
}

async function saveCategory(body = {}) {
  const checked = core.validateCategory(body, { claude: providerCore.CLAUDE_MODELS, codex: await codexCatalog() });
  if (checked.error) return checked;
  const edits = editsStore();
  edits.categories = { ...(edits.categories || {}), [checked.category.id]: { ...checked.category, editedAt: Date.now() } };
  saveEdits(edits);
  return { ok: true };
}

function resetCategory({ id }) {
  const edits = editsStore();
  if (!edits.categories?.[id]) return { error: MATRIX_MAINTAINER ? 'Cette catégorie n’a pas de modification publiée.' : 'Cette catégorie n’a pas de réglage local.' };
  delete edits.categories[id];
  saveEdits(edits);
  return { ok: true };
}

function recordRating(rating) {
  if (MATRIX_MAINTAINER) saveSharedRatings(core.addRating(sharedRatings(), rating));
  else saveStore(RATINGS, core.addRating(loadStore(RATINGS, []), rating));
}

async function availability() {
  const codex = await codexInfo();
  return { claude: true, codex: codex.installed && codex.loggedIn };
}

async function getCalibration() {
  const coverage = core.calibrationCoverage(merged(), core.aggregateRatings(allRatings()), { available: await availability(), target: CALIBRATION_TARGET });
  return coverage;
}

async function rescorePick({ category, provider, model, effort, score, why } = {}) {
  const current = merged().categories.find((c) => c.id === category);
  if (!current) return { error: `Catégorie inconnue : ${category}.` };
  const reason = String(why ?? '').trim();
  if (!reason) return { error: 'Une raison est requise pour réévaluer un choix.' };
  const next = core.rescorePicks(current.picks, { provider, model, effort, score: Number(score), why: reason });
  if (next.error) return next;
  const saved = await saveCategory({ id: current.id, label: current.label, description: current.description, picks: next.picks });
  return saved.error ? saved : { ok: true, category: current.id, label: current.label };
}

module.exports = { getCalibration, rescorePick, getMatrix, saveCategory, resetCategory, recordRating, categoryIds, SHARED_EDITS_FILE, SHARED_RATINGS_FILE, editsText, ratingsText };
