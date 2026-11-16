// Attention queue order, without I/O (also required by the tests). Groups by what the user is expected to do:
// answer (oldest request first, so nothing starves), review a finished turn, follow work in progress, a finished
// turn already opened, or nothing. Sessions that cannot be closed (main checkouts) live in a block of their own at the
// end, so they never mix with the work to follow.
const FIXED_GROUP = { id: 'fixed', label: 'Sessions fixes' };
const QUEUE_GROUPS = [
  { id: 'needs', label: 'À toi', statuses: ['needs_input'] },
  { id: 'review', label: 'À relire', statuses: ['done'] },
  { id: 'working', label: 'En cours', statuses: ['working'] },
  { id: 'read', label: 'Lu', statuses: [] },
  { id: 'idle', label: 'Au repos', statuses: null },
];

function queueGroupOf(status, read = false) {
  if (status === 'done' && read) return 'read';
  return (QUEUE_GROUPS.find((g) => g.statuses && g.statuses.includes(status)) || QUEUE_GROUPS[QUEUE_GROUPS.length - 1]).id;
}

// items: [{ key, status, read, pinned, fixed, since, activity }] → [{ id, label, items }] without empty groups.
function queueGroups(items) {
  return [...QUEUE_GROUPS, FIXED_GROUP].map((group) => {
    const list = items.filter((item) => (item.fixed ? FIXED_GROUP.id : queueGroupOf(item.status, item.read)) === group.id);
    const waiting = (item) => (item.status === 'needs_input' ? 0 : 1);
    const oldestFirst = (a, b) => (group.id === 'needs' || (group.id === FIXED_GROUP.id && !waiting(a) && !waiting(b)) ? (a.since || 0) - (b.since || 0) : (b.activity || 0) - (a.activity || 0));
    list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      || (group.id === FIXED_GROUP.id ? waiting(a) - waiting(b) : 0)
      || oldestFirst(a, b)
      || String(a.key).localeCompare(String(b.key)));
    return { id: group.id, label: group.label, items: list };
  }).filter((group) => group.items.length);
}

const queueFlat = (groups) => groups.flatMap((g) => g.items);

// Items by what they need from the user, fixed sessions included: the top bar pills and the "nothing else" line
// must see a main session that asks for an answer even though it is listed in its own block.
const queueByAttention = (groups, id) => queueFlat(groups).filter((item) => queueGroupOf(item.status, item.read) === id);

if (typeof module !== 'undefined') module.exports = { QUEUE_GROUPS, FIXED_GROUP, queueGroupOf, queueGroups, queueFlat, queueByAttention };
