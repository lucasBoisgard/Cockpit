// The final assistant message of the latest turn, read from a raw transcript, with the id the provider gave it.
// Claude: the last text block after the last real user message. Codex: the last assistant message of the turn
// (phase final_answer when the rollout says so).
const { textOf, userText } = require('./transcript');

function* jsonLines(text) {
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      yield JSON.parse(line);
    } catch {}
  }
}

// Only the final message of a finished turn counts. Claude marks it with a stop_reason other than tool_use on its last
// text entry (a text written before a tool call, or a half-flushed transcript, is not final).
function claudeFinalMessage(text) {
  let last = null;
  for (const entry of jsonLines(text)) {
    if (entry.isSidechain || entry.isMeta || !entry.message) continue;
    const content = entry.message.content;
    if (entry.type === 'user') {
      const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : (content || []).filter((b) => b.type === 'text');
      if (blocks.some((b) => userText(b.text))) last = null;
    } else if (entry.type === 'assistant' && Array.isArray(content)) {
      if (content.some((b) => b.type === 'tool_use')) last = null;
      const body = textOf(content.filter((b) => b.type === 'text')).trim();
      const stop = entry.message.stop_reason;
      if (body && entry.uuid) last = stop && stop !== 'tool_use' ? { id: entry.uuid, text: body } : null;
    }
  }
  return last;
}

const codexText = (content) => (Array.isArray(content) ? content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('') : '');

// A finished turn carries its final text in task_complete.last_agent_message. Without that event the turn is still running
// (or its transcript is not complete yet): a commentary or an unfinished final_answer is never taken for the final message.
function codexFinalMessage(text) {
  let complete = null;
  const assistant = [];
  const reset = () => {
    complete = null;
    assistant.length = 0;
  };
  for (const entry of jsonLines(text)) {
    const p = entry.payload || {};
    if (entry.type === 'event_msg' && p.type === 'task_started') reset();
    else if (entry.type === 'event_msg' && p.type === 'task_complete') {
      if (typeof p.last_agent_message === 'string' && p.last_agent_message.trim()) complete = { text: p.last_agent_message.trim(), turnId: p.turn_id || null };
    } else if (entry.type === 'response_item' && p.type === 'message' && p.role === 'user' && !/^<[a-z_]+>/.test(codexText(p.content).trim())) reset();
    else if (entry.type === 'response_item' && p.type === 'message' && p.role === 'assistant') {
      const body = codexText(p.content).trim();
      if (body) assistant.push({ id: p.id || null, text: body });
    }
  }
  if (!complete) return null;
  const same = [...assistant].reverse().find((m) => m.text === complete.text);
  const id = same?.id || complete.turnId;
  return id ? { id, text: complete.text } : null;
}

const finalMessage = (provider, text) => (provider === 'codex' ? codexFinalMessage(text) : claudeFinalMessage(text));

module.exports = { claudeFinalMessage, codexFinalMessage, finalMessage };
