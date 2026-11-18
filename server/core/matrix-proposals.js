// Rescores proposed by a master wait for the user's decision: a pending proposal never reaches the recommendation
// (`applyEdits` only reads `categories`), validating applies it and keeps the previous value so it can be undone.
const { rescorePicks } = require('./matrix');

const MAX_KEPT = 200;
const list = (edits) => (Array.isArray(edits?.proposals) ? edits.proposals : []);
const same = (p, t) => p.provider === t.provider && p.model === t.model && (p.effort || null) === (t.effort || null);

function createProposal(current, { provider, model, effort, score, why, author, at }) {
  const found = (current.picks || []).find((p) => same(p, { provider, model, effort }));
  return {
    id: `${current.id}:${provider}:${model}:${effort || '-'}:${at}`,
    category: current.id,
    provider,
    model,
    effort: effort || null,
    score,
    why,
    previous: found ? { score: found.score, why: found.why } : null,
    author: author || null,
    at,
    status: 'pending',
  };
}

const pendingProposals = (edits) => list(edits).filter((p) => p.status === 'pending');

const appliedProposals = (edits) => list(edits).filter((p) => p.status === 'validated').slice(-20);

function addProposal(edits, proposal) {
  const kept = list(edits).filter((p) => !(p.status === 'pending' && p.category === proposal.category && same(p, proposal)));
  return { ...edits, proposals: [...kept, proposal].slice(-MAX_KEPT) };
}

function decide(edits, id, status, now) {
  const proposals = list(edits);
  const index = proposals.findIndex((p) => p.id === id && p.status === 'pending');
  if (index < 0) return { error: 'Proposition introuvable ou déjà traitée.' };
  const next = proposals.map((p, i) => (i === index ? { ...p, status, decidedAt: now } : p));
  return { edits: { ...edits, proposals: next }, proposal: proposals[index] };
}

// Applies a validated proposal on the category's current picks; the picks to save, or an error.
function applyProposal(picks, proposal) {
  return rescorePicks(picks, proposal);
}

// Puts the previous value back (or removes the pick when the proposal had added it).
function revertPicks(picks, proposal) {
  if (!proposal.previous) return { picks: picks.filter((p) => !same(p, proposal)) };
  return { picks: picks.map((p) => (same(p, proposal) ? { ...p, score: proposal.previous.score, why: proposal.previous.why } : p)) };
}

module.exports = { createProposal, addProposal, pendingProposals, appliedProposals, decide, applyProposal, revertPicks };
