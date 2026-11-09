// Read turns, without I/O (also required by the tests). A finished turn ("done") becomes "read" once the user
// has opened it; a new turn finishing later has a newer statusSince and is unread again.
const SEEN_TURNS_MAX = 400;

function turnStamp(session) {
  if (!session || session.status !== 'done') return null;
  return session.statusSince || session.updatedAt || 0;
}

function isTurnRead(session, seen) {
  const stamp = turnStamp(session);
  return stamp !== null && (seen?.[session.sessionId] ?? -1) >= stamp;
}

function markTurnRead(session, seen) {
  const stamp = turnStamp(session);
  if (stamp === null || isTurnRead(session, seen)) return seen;
  const next = { ...seen, [session.sessionId]: stamp };
  const ids = Object.keys(next);
  if (ids.length <= SEEN_TURNS_MAX) return next;
  return Object.fromEntries(ids.sort((a, b) => next[b] - next[a]).slice(0, SEEN_TURNS_MAX).map((id) => [id, next[id]]));
}

if (typeof module !== 'undefined') module.exports = { SEEN_TURNS_MAX, turnStamp, isTurnRead, markTurnRead };
