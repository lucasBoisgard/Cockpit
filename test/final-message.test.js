const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { claudeFinalMessage, codexFinalMessage, finalMessage } = require('../server/core/final-message');

const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('Claude: the last text block of the turn with its entry uuid, not an earlier one', () => {
  const found = claudeFinalMessage(fixture('final-message-claude.jsonl'));
  assert.equal(found.id, 'a4');
  assert.match(found.text, /<verdict-report v="1">[\s\S]*<\/verdict-report>$/);
});

test('Claude: a tool result is not a new user turn, a real user message resets the turn', () => {
  const text = `${fixture('final-message-claude.jsonl')}${JSON.stringify({ type: 'user', uuid: 'u3', message: { role: 'user', content: 'next question' } })}\n`;
  assert.equal(claudeFinalMessage(text), null);
});

test('Claude: sidechain and meta entries are ignored, garbage lines are skipped', () => {
  const text = `not json\n${JSON.stringify({ type: 'assistant', uuid: 'x', isSidechain: true, message: { content: [{ type: 'text', text: 'sub' }] } })}\n${JSON.stringify({ type: 'assistant', uuid: 'y', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: 'real' }] } })}\n`;
  assert.deepEqual(claudeFinalMessage(text), { id: 'y', text: 'real' });
});

test('Codex: the final_answer message with its id, not the commentary', () => {
  const found = codexFinalMessage(fixture('final-message-codex.jsonl'));
  assert.equal(found.id, 'msg_f1');
  assert.match(found.text, /^TERMINÉ/);
});

test('Codex: a new task_started resets the turn', () => {
  const rows = [assistant('m1', 'one'), complete('one')].join('\n');
  assert.equal(codexFinalMessage(rows).id, 'm1');
  assert.equal(codexFinalMessage(`${rows}\n${JSON.stringify({ type: 'event_msg', payload: { type: 'task_started' } })}`), null);
});

const codexLine = (type, payload) => JSON.stringify({ timestamp: '2026-01-01T00:00:00.000Z', type, payload });
const assistant = (id, text, phase) => codexLine('response_item', { type: 'message', id, role: 'assistant', phase, content: [{ type: 'output_text', text }] });
const complete = (text) => codexLine('event_msg', { type: 'task_complete', turn_id: 'turn-9', last_agent_message: text });

test('Codex: task_complete.last_agent_message is the final text, with the id of the message that holds it, else the turn id', () => {
  const rows = [assistant('m1', 'first', 'commentary'), assistant('m2', 'answer', 'final_answer'), assistant('m3', 'late comment', 'commentary')];
  assert.deepEqual(codexFinalMessage([...rows, complete('answer')].join('\n')), { id: 'm2', text: 'answer' });
  assert.deepEqual(codexFinalMessage([...rows, complete('not in any message')].join('\n')), { id: 'turn-9', text: 'not in any message' });
});

test('Codex: without task_complete nothing is final, whatever commentary or final_answer is already there', () => {
  const rows = [assistant('m1', 'answer', 'final_answer'), assistant('m2', 'trailing', 'commentary')];
  assert.equal(codexFinalMessage(rows.join('\n')), null);
  assert.equal(codexFinalMessage([...rows, complete(null)].join('\n')), null);
});

test('Claude: a text written before a tool call, or a half-flushed entry without stop_reason, is not final', () => {
  const entry = (uuid, stop, content) => JSON.stringify({ type: 'assistant', uuid, message: { stop_reason: stop, content } });
  const text = (t) => [{ type: 'text', text: t }];
  assert.equal(claudeFinalMessage(entry('a', 'tool_use', text('let me check'))), null);
  assert.equal(claudeFinalMessage(entry('a', null, text('partial'))), null);
  assert.equal(claudeFinalMessage([entry('a', 'end_turn', text('answer')), entry('b', 'tool_use', [{ type: 'tool_use', id: 't', name: 'Bash', input: {} }])].join('\n')), null);
  assert.equal(claudeFinalMessage([entry('a', 'tool_use', text('checking')), entry('b', 'end_turn', text('answer'))].join('\n')).id, 'b');
});

test('Codex: an injected user message starts a new turn, an injected context block does not', () => {
  const user = (text) => codexLine('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text }] });
  assert.equal(codexFinalMessage([assistant('m1', 'old', 'final_answer'), complete('old'), user('<environment_context>x</environment_context>')].join('\n')).id, 'm1');
  assert.equal(codexFinalMessage([assistant('m1', 'old', 'final_answer'), complete('old'), user('next instruction')].join('\n')), null);
});

test('finalMessage dispatches on the provider', () => {
  assert.equal(finalMessage('codex', fixture('final-message-codex.jsonl')).id, 'msg_f1');
  assert.equal(finalMessage(undefined, fixture('final-message-claude.jsonl')).id, 'a4');
  assert.equal(finalMessage('claude', ''), null);
});
