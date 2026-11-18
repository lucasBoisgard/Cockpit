// When the shared session → transcripts index is rebuilt: never inline once it exists (a stale index is served
// while a rebuild runs after the request), at most once per interval, whatever the sessions asked for.
const SESSION_INDEX_TTL_MS = 60000;

function indexAction({ builtAt, building, now }) {
  if (builtAt == null) return 'build-now';
  if (building || now - builtAt <= SESSION_INDEX_TTL_MS) return 'use';
  return 'rebuild-later';
}

module.exports = { SESSION_INDEX_TTL_MS, indexAction };
