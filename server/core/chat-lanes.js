const COCKPIT_PREFIX = '[cockpit]';
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const patterns = new Map();

// A milestone the master writes for the user starts with `@user`, or `@<name>` when `user.name` is configured.
// The handle must end there: `@userfoo` or `@Ana-Maria` (for `Ana`) are not milestones.
function milestonePattern(names = []) {
  const handles = ['user', ...names.map((n) => String(n || '').trim().replace(/^@+/, '').normalize('NFC')).filter(Boolean).map(escapeRegex)];
  const key = handles.join('\0');
  if (!patterns.has(key)) patterns.set(key, new RegExp(`^@(?:${handles.join('|')})(?![\\p{L}\\p{M}\\p{N}_]|-[\\p{L}\\p{N}])[\\s:,\\-–—]*`, 'iu'));
  return patterns.get(key);
}

function isCockpitMessage(text) {
  return String(text || '').trimStart().startsWith(COCKPIT_PREFIX);
}

function milestoneBody(text, names = []) {
  const trimmed = String(text || '').trimStart().normalize('NFC');
  const match = trimmed.match(milestonePattern(names));
  return match ? trimmed.slice(match[0].length) : null;
}

const LANES = ['conversation', 'agents'];

// A turn belongs to the lane of the message that started it. A [cockpit] message is never a user
// bubble: mid-turn it stays in the agents lane without taking the turn over. A message from the user
// always takes the turn over. A question asked to the user stays visible in the conversation.
function assignLanes(items, { names = [] } = {}) {
  let segment = 'conversation';
  let previous = null;
  return items.map((item) => {
    const midTurn = previous?.kind === 'tool';
    previous = item;
    if (item.kind === 'user') {
      if (!isCockpitMessage(item.text)) {
        segment = 'conversation';
        return { ...item, lane: segment };
      }
      if (!midTurn) segment = 'agents';
      return { ...item, lane: 'agents' };
    }
    if (item.kind === 'assistant' && segment === 'agents') {
      const body = milestoneBody(item.text, names);
      if (body !== null) return { ...item, text: body, lane: 'conversation', milestone: true };
    }
    if (item.kind === 'tool' && item.tool === 'AskUserQuestion' && segment === 'agents') return { ...item, lane: segment, forUser: true };
    return { ...item, lane: segment };
  });
}

const shownIn = (item, lane) => item.lane === lane || (lane === 'conversation' && item.forUser);

// Keeps the last `max` items of each lane, so a busy lane cannot push the other one out of the window.
function limitByLane(items, max) {
  const totals = {};
  const kept = new Set();
  for (const lane of LANES) {
    const own = items.filter((item) => shownIn(item, lane));
    totals[lane] = own.length;
    own.slice(-max).forEach((item) => kept.add(item));
  }
  return {
    items: items.filter((item) => kept.has(item)),
    totals,
    agentTurns: items.filter((item) => item.kind === 'user' && item.lane === 'agents').length,
  };
}

module.exports = { isCockpitMessage, milestoneBody, assignLanes, limitByLane };
