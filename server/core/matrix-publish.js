// Automatic publication of the maintainer's matrix learning, without I/O: when to publish, which ratings are new
// and the commit message.
const { ratingKey } = require('./matrix');
const { retain } = require('./verdicts');

const QUIET_MS = 90 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const ALERT_AFTER_FAILURES = 3;

// Publish once the matrix has been quiet long enough, so that a burst of ratings (an Arène run) makes one commit.
function publishDue({ now, lastWriteAt, lastFailureAt = 0 }) {
  if (!lastWriteAt) return false;
  if (lastFailureAt && now - lastFailureAt < RETRY_MS) return false;
  return now - lastWriteAt >= QUIET_MS;
}

function newRatings(remote = [], merged = []) {
  const known = new Set(remote.map(ratingKey));
  return merged.filter((r) => !known.has(ratingKey(r)));
}

function changedCategories(remote = {}, local = {}) {
  const ids = new Set([...Object.keys(remote.categories || {}), ...Object.keys(local.categories || {})]);
  return [...ids].filter((id) => JSON.stringify(remote.categories?.[id] ?? null) !== JSON.stringify(local.categories?.[id] ?? null)).sort();
}

const byId = (list) => new Map((Array.isArray(list) ? list : []).map((p) => [p.id, p]));

function changedProposals(ancestor = {}, local = {}) {
  const [a, l] = [byId(ancestor.proposals), byId(local.proposals)];
  return [...new Set([...a.keys(), ...l.keys()])].filter((id) => JSON.stringify(a.get(id) ?? null) !== JSON.stringify(l.get(id) ?? null)).sort();
}

const list = (value) => (Array.isArray(value) ? value : []);

// Verdict records are keyed by id: a local record that is new, or differs from the checkout's HEAD (an outcome
// replaced), goes onto the remote's list; the retention then drops the oldest observations with their dependants.
function mergeVerdicts({ ancestor = [], local = [], remote = [] }) {
  const before = new Map(list(ancestor).map((r) => [r.id, JSON.stringify(r)]));
  const merged = new Map(list(remote).map((r) => [r.id, JSON.stringify(r)]));
  const records = new Map(list(remote).map((r) => [r.id, r]));
  const added = list(local).filter((r) => r && r.id && before.get(r.id) !== JSON.stringify(r) && merged.get(r.id) !== JSON.stringify(r));
  for (const r of added) records.set(r.id, r);
  return { verdicts: retain([...records.values()]), added };
}

// Three-way merge against the checkout's HEAD (the ancestor): only what changed locally since HEAD is published,
// everything else keeps the remote's version, so a checkout behind the remote never reverts it.
function mergeForPublish({ ancestor, local, remote }) {
  const changed = changedCategories(ancestor.edits, local.edits);
  const categories = { ...(remote.edits.categories || {}) };
  for (const id of changed) {
    if (local.edits.categories?.[id]) categories[id] = local.edits.categories[id];
    else delete categories[id];
  }
  const proposals = byId(remote.edits.proposals);
  const changedIds = changedProposals(ancestor.edits, local.edits);
  const localProposals = byId(local.edits.proposals);
  for (const id of changedIds) {
    if (localProposals.has(id)) proposals.set(id, localProposals.get(id));
    else proposals.delete(id);
  }
  const edits = { ...remote.edits, categories, ...(proposals.size || remote.edits.proposals ? { proposals: [...proposals.values()] } : {}) };
  const known = new Set([...ancestor.ratings, ...remote.ratings].map(ratingKey));
  const added = local.ratings.filter((r) => !known.has(ratingKey(r)));
  const merged = mergeVerdicts({ ancestor: ancestor.verdicts, local: local.verdicts, remote: remote.verdicts });
  return { edits, ratings: [...remote.ratings, ...added], added, verdicts: merged.verdicts, addedVerdicts: merged.added, categories: changedCategories(remote.edits, edits), proposals: changedProposals(remote.edits, edits) };
}

function commitMessage({ ratings = [], verdicts = [], categories = [], proposals = [] }) {
  const parts = [];
  if (verdicts.length) parts.push(`${verdicts.length} verdict${verdicts.length > 1 ? 's' : ''}`);
  if (ratings.length) {
    const kinds = [...new Set(ratings.map((r) => r.category).filter(Boolean))].sort();
    parts.push(`${ratings.length} rating${ratings.length > 1 ? 's' : ''}${kinds.length ? ` (${kinds.join(', ')})` : ''}`);
  }
  if (categories.length) parts.push(`${categories.length} category edit${categories.length > 1 ? 's' : ''} (${categories.join(', ')})`);
  if (proposals.length) parts.push(`${proposals.length} rescore proposal${proposals.length > 1 ? 's' : ''}`);
  return `chore(matrix): publish ${parts.join(' and ') || 'matrix data'}`;
}

module.exports = { QUIET_MS, RETRY_MS, ALERT_AFTER_FAILURES, publishDue, newRatings, mergeVerdicts, changedCategories, changedProposals, mergeForPublish, commitMessage };
