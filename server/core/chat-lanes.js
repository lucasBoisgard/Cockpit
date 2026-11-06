const COCKPIT_PREFIX = '[cockpit]';
const MILESTONE = /^@lucas\b[\s:,\-–—]*/i;

function isCockpitMessage(text) {
  return String(text || '').trimStart().startsWith(COCKPIT_PREFIX);
}

function milestoneBody(text) {
  const trimmed = String(text || '').trimStart();
  const match = trimmed.match(MILESTONE);
  return match ? trimmed.slice(match[0].length) : null;
}

// A turn belongs to the lane of the message that started it. A message that arrives mid-turn
// (right after a tool call) does not start a turn, except a human one: the master then answers the user.
function assignLanes(items) {
  let segment = 'conversation';
  let previous = null;
  return items.map((item) => {
    const midTurn = previous?.kind === 'tool';
    previous = item;
    if (item.kind === 'user') {
      if (!isCockpitMessage(item.text)) segment = 'conversation';
      else if (!midTurn) segment = 'agents';
      return { ...item, lane: segment };
    }
    if (item.kind === 'assistant' && segment === 'agents') {
      const body = milestoneBody(item.text);
      if (body !== null) return { ...item, text: body, lane: 'conversation', milestone: true };
    }
    return { ...item, lane: segment };
  });
}

module.exports = { isCockpitMessage, milestoneBody, assignLanes };
