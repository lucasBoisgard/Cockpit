const fs = require('node:fs');
const path = require('node:path');
const { ROOT, MATRIX_MAINTAINER } = require('../config');
const { readJson, loadStore, saveStore } = require('../io/store');
const core = require('../core/matrix');
const proposals = require('../core/matrix-proposals');
const verdicts = require('../core/verdicts');
const providerCore = require('../core/providers');
const { codexInfo, codexCatalog } = require('./providers');

const DATA = path.join(ROOT, 'server', 'data');
const DEFAULT_FILE = path.join(DATA, 'model-matrix.json');
// Versioned in the repo and written only by the maintainer's cockpit (`matrix.maintainer` in cockpit.config.json):
// every other install starts from them and keeps its own learning in ~/.claude.
const SHARED_EDITS_FILE = path.join(DATA, 'model-matrix-edits.json');
const SHARED_RATINGS_FILE = path.join(DATA, 'model-ratings.json');
const SHARED_VERDICTS_FILE = path.join(DATA, 'model-verdicts.json');
const OVERRIDES = 'worktree-matrix.json';
const RATINGS = 'worktree-matrix-ratings.json';
const VERDICTS = 'worktree-matrix-verdicts.json';
const COVERAGE = 'worktree-matrix-coverage.json';
const USAGE_CACHE_MS = 60 * 1000;
const RECENT_VERDICTS = 30;

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
const sharedVerdicts = () => objectOr(readJson(SHARED_VERDICTS_FILE), []);
const editsText = (edits) => `${JSON.stringify(edits, null, 2)}\n`;
// One rating per line, so that a new rating is a one-line diff.
const ratingsText = (ratings) => `[\n${ratings.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`;
const verdictsText = (records) => (records.length ? ratingsText(records) : '[]\n');
const saveSharedEdits = (edits) => writeRepoFile(SHARED_EDITS_FILE, editsText(edits));
const saveSharedVerdicts = (records) => writeRepoFile(SHARED_VERDICTS_FILE, verdictsText(records));

const editsStore = () => (MATRIX_MAINTAINER ? sharedEdits() : loadStore(OVERRIDES, {}));
const saveEdits = (edits) => (MATRIX_MAINTAINER ? saveSharedEdits(edits) : saveStore(OVERRIDES, edits));

const merged = () => core.mergeMatrix(core.applyEdits(defaults(), sharedEdits()), MATRIX_MAINTAINER ? {} : loadStore(OVERRIDES, {}));
const allRatings = () => core.legacyRatings(core.combineRatings(sharedRatings(), MATRIX_MAINTAINER ? [] : loadStore(RATINGS, [])));

const verdictsStore = () => (MATRIX_MAINTAINER ? sharedVerdicts() : loadStore(VERDICTS, []));
const readVerdictRecords = () => core.addVerdicts(sharedVerdicts(), MATRIX_MAINTAINER ? [] : loadStore(VERDICTS, [])).records;

// Stores new verdict records; returns how many were new or changed and kept. Records without an id are ignored.
function appendVerdictRecords(records = []) {
  const { records: next, added } = core.addVerdicts(verdictsStore(), records);
  if (!added) return 0;
  if (MATRIX_MAINTAINER) saveSharedVerdicts(next);
  else saveStore(VERDICTS, next);
  return added;
}

const pickOf = (r) => r.pick || r;
const outcomeMeasures = (records) => records.filter((r) => r.type === 'outcome').map((r) => {
  const p = pickOf(r);
  return { obs: p.obs, category: p.category, provider: p.provider, model: p.model, effort: p.effort || null, tokens: r.tokens, durationMs: r.durationMs, at: r.at };
});

const readCoverage = () => core.cleanCoverage(loadStore(COVERAGE, {}));

// One more launch: every fifth earns a credit (the rule lives in verdicts.addLaunch).
function recordLaunch() {
  const next = verdicts.addLaunch(readCoverage());
  saveStore(COVERAGE, next);
  return next;
}

// An exploration launch spends a banked credit; false when there is none.
function spendCredit() {
  const coverage = readCoverage();
  if (!(coverage.credits > 0)) return false;
  saveStore(COVERAGE, verdicts.spendCredit(coverage));
  return true;
}
const categoryIds = () => merged().categories.map((c) => c.id);

let usageRows = { at: 0, rows: [] };

// The agents' usage rows are read from the whole history: kept for a minute, as the page polls the matrix.
function cachedUsageRows(now = Date.now()) {
  if (now - usageRows.at >= USAGE_CACHE_MS) usageRows = { at: now, rows: require('./usage').usageHistory(0).orchestrations.flatMap((g) => g.rows) };
  return usageRows.rows;
}

function measuredAgents(records) {
  try {
    const rows = cachedUsageRows();
    return core.aggregateMeasured(rows, [...allRatings(), ...outcomeMeasures(records)]);
  } catch (error) {
    console.error('measured agents failed', error);
    return {};
  }
}

// What the verdicts say of each pick, by pick key; the matrix reference of a pick is its prior.
function pickScores(records, matrix) {
  const refOf = (p) => matrix.categories.find((c) => c.id === p.category)?.picks.find((x) => x.provider === p.provider && x.model === p.model && (x.effort || null) === (p.effort || null))?.score ?? null;
  const scored = verdicts.pickScores(records, allRatings(), refOf);
  return Object.fromEntries(Object.values(scored).map((e) => [core.keyOf(e.category, e), e]));
}

// The matrix with, per category, the picks ranked by score out of 100 and the evidence behind it.
async function getMatrix() {
  const matrix = merged();
  const codex = await codexInfo();
  const available = { claude: true, codex: codex.installed && codex.loggedIn };
  const records = readVerdictRecords();
  const scores = pickScores(records, matrix);
  const measured = measuredAgents(records);
  const coverage = readCoverage();
  return {
    note: matrix.note,
    available,
    maintainer: MATRIX_MAINTAINER,
    models: matrix.models,
    coverage,
    categories: matrix.categories.map((c) => {
      const ranked = core.recommend(matrix, c.id, { available, scores, measured });
      const candidate = verdicts.coverageCandidate(ranked, ranked.picks.map((p) => ({ key: p.key, ref: p.score, available: p.available, V: p.verified, S: p.quality, quotaCost: p.expectedCost })), coverage);
      return { ...ranked, coverageCandidate: candidate ? { key: candidate.pick.key, mode: candidate.mode } : null };
    }),
    recent: records.filter((r) => r.type === 'finding' || r.type === 'clean').slice(-RECENT_VERDICTS).reverse(),
    proposals: proposals.pendingProposals(editsStore()),
    applied: proposals.appliedProposals(editsStore()),
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

async function availability() {
  const codex = await codexInfo();
  return { claude: true, codex: codex.installed && codex.loggedIn };
}

async function getCalibration() {
  const matrix = merged();
  return core.calibrationCoverage(matrix, pickScores(readVerdictRecords(), matrix), { available: await availability() });
}

const catalogs = async () => ({ claude: providerCore.CLAUDE_MODELS, codex: await codexCatalog() });

// What a category would hold once its picks are replaced: validated like a hand edit (known models, integer score, pick limit).
async function checkedCategory(current, picks) {
  return core.validateCategory({ id: current.id, label: current.label, description: current.description, picks }, await catalogs());
}

async function rescorePick({ category, provider, model, effort, score, why, author } = {}) {
  const current = merged().categories.find((c) => c.id === category);
  if (!current) return { error: `Catégorie inconnue : ${category}.` };
  const reason = String(why ?? '').trim();
  if (!reason) return { error: 'Une raison est requise pour réévaluer un choix.' };
  const next = core.rescorePicks(current.picks, { provider, model, effort, score: Number(score), why: reason });
  if (next.error) return next;
  const checked = await checkedCategory(current, next.picks);
  if (checked.error) return checked;
  const proposal = proposals.createProposal(current, { provider, model, effort: effort || null, score: Number(score), why: reason, author, at: Date.now() });
  saveEdits(proposals.addProposal(editsStore(), proposal));
  return { ok: true, pending: true, category: current.id, label: current.label, id: proposal.id };
}

function saveAppliedPicks(edits, current, category) {
  const editedAt = Date.now();
  edits.categories = { ...(edits.categories || {}), [current.id]: { ...category, editedAt } };
  return editedAt;
}

async function decideProposal({ id, decision } = {}) {
  if (decision !== 'validate' && decision !== 'reject') return { error: 'Décision inconnue.' };
  const edits = editsStore();
  const decided = proposals.decide(edits, id, decision === 'validate' ? 'validated' : 'rejected', Date.now());
  if (decided.error) return decided;
  if (decision === 'reject') {
    saveEdits(decided.edits);
    return { ok: true };
  }
  const { proposal } = decided;
  const current = merged().categories.find((c) => c.id === proposal.category);
  if (!current) return { error: `Catégorie inconnue : ${proposal.category}.` };
  const next = proposals.applyProposal(current.picks, proposal);
  if (next.error) return next;
  const checked = await checkedCategory(current, next.picks);
  if (checked.error) return checked;
  const editedAt = saveAppliedPicks(decided.edits, current, checked.category);
  const held = current.picks.find((p) => p.provider === proposal.provider && p.model === proposal.model && (p.effort || null) === (proposal.effort || null));
  const previous = held ? { score: held.score, why: held.why } : null;
  decided.edits.proposals = decided.edits.proposals.map((p) => (p.id === id ? { ...p, previous, appliedEditedAt: editedAt } : p));
  saveEdits(decided.edits);
  return { ok: true };
}

// Puts a validated proposal's previous value back, unless the category was edited since it was applied.
async function revertProposal({ id } = {}) {
  const edits = editsStore();
  const proposal = (edits.proposals || []).find((p) => p.id === id && p.status === 'validated');
  if (!proposal) return { error: 'Proposition introuvable ou déjà annulée.' };
  const current = merged().categories.find((c) => c.id === proposal.category);
  if (!current) return { error: `Catégorie inconnue : ${proposal.category}.` };
  if (current.editedAt !== proposal.appliedEditedAt) return { error: 'La catégorie a changé depuis cette validation : modifie-la à la main ou reviens au défaut.' };
  const checked = await checkedCategory(current, proposals.revertPicks(current.picks, proposal).picks);
  if (checked.error) return checked;
  const next = { ...edits, proposals: edits.proposals.map((p) => (p.id === id ? { ...p, status: 'reverted', decidedAt: Date.now() } : p)) };
  saveAppliedPicks(next, current, checked.category);
  saveEdits(next);
  return { ok: true };
}

module.exports = { getCalibration, rescorePick, decideProposal, revertProposal, getMatrix, saveCategory, resetCategory, appendVerdictRecords, readVerdictRecords, readCoverage, recordLaunch, spendCredit, categoryIds, SHARED_EDITS_FILE, SHARED_RATINGS_FILE, SHARED_VERDICTS_FILE, editsText, ratingsText, verdictsText };
