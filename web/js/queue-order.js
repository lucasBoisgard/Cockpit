// Attention queue order, without I/O (also required by the tests). Groups by what the user is expected to do:
// answer (oldest request first, so nothing starves), review a finished turn, follow work in progress, a finished
// turn already opened, or nothing.
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

// items: [{ key, status, read, pinned, since, activity }] → [{ id, label, items }] without empty groups.
function queueGroups(items) {
  return QUEUE_GROUPS.map((group) => {
    const list = items.filter((item) => queueGroupOf(item.status, item.read) === group.id);
    list.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      || (group.id === 'needs' ? (a.since || 0) - (b.since || 0) : (b.activity || 0) - (a.activity || 0))
      || String(a.key).localeCompare(String(b.key)));
    return { id: group.id, label: group.label, items: list };
  }).filter((group) => group.items.length);
}

const queueFlat = (groups) => groups.flatMap((g) => g.items);

if (typeof module !== 'undefined') module.exports = { QUEUE_GROUPS, queueGroupOf, queueGroups, queueFlat };
