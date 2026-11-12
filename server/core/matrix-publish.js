// Automatic publication of the maintainer's matrix learning, without I/O: when to publish, which ratings are new
// and the commit message.
const { ratingKey } = require('./matrix');

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

// Three-way merge against the checkout's HEAD (the ancestor): only what changed locally since HEAD is published,
// everything else keeps the remote's version, so a checkout behind the remote never reverts it.
function mergeForPublish({ ancestor, local, remote }) {
  const changed = changedCategories(ancestor.edits, local.edits);
  const categories = { ...(remote.edits.categories || {}) };
  for (const id of changed) {
    if (local.edits.categories?.[id]) categories[id] = local.edits.categories[id];
    else delete categories[id];
  }
  const edits = { ...remote.edits, categories };
  const known = new Set([...ancestor.ratings, ...remote.ratings].map(ratingKey));
  const added = local.ratings.filter((r) => !known.has(ratingKey(r)));
  return { edits, ratings: [...remote.ratings, ...added], added, categories: changedCategories(remote.edits, edits) };
}

function commitMessage({ ratings = [], categories = [] }) {
  const parts = [];
  if (ratings.length) {
    const kinds = [...new Set(ratings.map((r) => r.category).filter(Boolean))].sort();
    parts.push(`${ratings.length} rating${ratings.length > 1 ? 's' : ''}${kinds.length ? ` (${kinds.join(', ')})` : ''}`);
  }
  if (categories.length) parts.push(`${categories.length} category edit${categories.length > 1 ? 's' : ''} (${categories.join(', ')})`);
  return `chore(matrix): publish ${parts.join(' and ') || 'matrix data'}`;
}

module.exports = { QUIET_MS, RETRY_MS, ALERT_AFTER_FAILURES, publishDue, newRatings, changedCategories, mergeForPublish, commitMessage };
