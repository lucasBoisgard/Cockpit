const test = require('node:test');
const assert = require('node:assert');
const { applyHookEvent, shorten } = require('../hooks/state-transition');

function replay(events, state = { actions: [] }) {
  for (const [now, input, pane = '%1'] of events) applyHookEvent(state, { session_id: 's', ...input }, { now, pane, fallbackCwd: '/fallback' });
  return state;
}

const start = [1000, { hook_event_name: 'SessionStart', cwd: '/repo', transcript_path: '/t.jsonl' }];
const prompt = (now, text = 'do it') => [now, { hook_event_name: 'UserPromptSubmit', prompt: text }];
const tool = (now, tool_name = 'Bash', tool_input = { command: 'ls' }) => [now, { hook_event_name: 'PreToolUse', tool_name, tool_input }];
const stop = (now, extra = {}) => [now, { hook_event_name: 'Stop', ...extra }];

test('a session starts idle, with its cwd, transcript and pane', () => {
  const state = replay([start]);
  assert.deepStrictEqual(state, { actions: [], sessionId: 's', cwd: '/repo', transcriptPath: '/t.jsonl', tmuxPaneSince: 1000, tmuxPane: '%1', startedAt: 1000, updatedAt: 1000, status: 'idle', statusSince: 1000 });
});

test('a prompt starts a turn and records the task once', () => {
  const state = replay([start, prompt(2000, 'first   task'), stop(3000), prompt(4000, 'second')]);
  assert.strictEqual(state.status, 'working');
  assert.strictEqual(state.turnStartedAt, 4000);
  assert.strictEqual(state.statusSince, 4000);
  assert.strictEqual(state.task, 'first task');
  assert.strictEqual(state.lastPrompt, 'second');
});

test('tool calls during a turn do not reset statusSince', () => {
  const state = replay([start, prompt(2000), tool(3000), tool(4000, 'Read', { file_path: '/repo/src/a.js' })]);
  assert.strictEqual(state.status, 'working');
  assert.strictEqual(state.statusSince, 2000);
  assert.strictEqual(state.updatedAt, 4000);
  assert.deepStrictEqual(state.actions.map((a) => [a.tool, a.detail, a.at]), [['Read', 'src/a.js', 4000], ['Bash', 'ls', 3000]]);
});

test('workedMs counts working time and excludes waits for the user', () => {
  const state = replay([
    start,
    prompt(2000),
    tool(3000),
    [5000, { hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' }],
    tool(65000),
    stop(70000),
  ]);
  assert.strictEqual(state.status, 'done');
  assert.strictEqual(state.workedMs, 3000 + 5000);
  assert.strictEqual(state.permission, false);
});

test('a question waits for input and its answer resumes the work', () => {
  const ask = tool(3000, 'AskUserQuestion', { questions: [{ question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }] });
  const state = replay([start, prompt(2000), ask]);
  assert.strictEqual(state.status, 'needs_input');
  assert.deepStrictEqual(state.question, { text: 'Which one?', options: ['A', 'B'], multi: true });
  assert.strictEqual(state.message, 'Which one?');
  assert.strictEqual(state.workedMs, 1000);
  replay([tool(9000)], state);
  assert.strictEqual(state.status, 'working');
  assert.strictEqual(state.question, null);
  assert.strictEqual(state.statusSince, 9000);
});

test('an interrupted turn is counted up to its last activity when the next prompt arrives', () => {
  const state = replay([start, prompt(2000), tool(5000), prompt(60000)]);
  assert.strictEqual(state.status, 'working');
  assert.strictEqual(state.workedMs, 3000);
  assert.strictEqual(state.statusSince, 60000);
  assert.strictEqual(state.turnStartedAt, 60000);
});

test('ignored events change nothing worth writing', () => {
  const state = replay([start, prompt(2000)]);
  const opts = { now: 3000, pane: '%1', fallbackCwd: '/x' };
  assert.strictEqual(applyHookEvent({ ...state }, { session_id: 's', hook_event_name: 'Notification', notification_type: 'idle_prompt' }, opts), false);
  assert.strictEqual(applyHookEvent({ ...state }, { session_id: 's', hook_event_name: 'Notification', message: 'Claude is waiting for your input' }, opts), false);
  assert.strictEqual(applyHookEvent({ ...state }, { session_id: 's', hook_event_name: 'Stop', stop_hook_active: true }, opts), false);
  assert.strictEqual(applyHookEvent({ ...state }, { session_id: 's', hook_event_name: 'PostToolUse' }, opts), false);
  assert.strictEqual(applyHookEvent({ ...state }, { session_id: 's', hook_event_name: 'SessionEnd' }, opts), true);
});

test('stop keeps the last assistant message and ends the wait', () => {
  const state = replay([start, prompt(2000), [3000, { hook_event_name: 'Notification', message: 'Needs permission' }], stop(4000, { last_assistant_message: 'All   done' })]);
  assert.strictEqual(state.status, 'done');
  assert.strictEqual(state.lastAssistant, 'All done');
  assert.strictEqual(state.message, null);
  assert.strictEqual(state.permission, false);
  assert.strictEqual(state.workedMs, 1000);
});

test('a new pane is recorded with the time it appeared, the cwd falls back', () => {
  const state = replay([prompt(2000), tool(3000), [4000, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }, '%2']]);
  assert.strictEqual(state.cwd, '/fallback');
  assert.strictEqual(state.tmuxPane, '%2');
  assert.strictEqual(state.tmuxPaneSince, 4000);
});

test('shorten collapses whitespace and cuts with an ellipsis', () => {
  assert.strictEqual(shorten('a \n b'), 'a b');
  assert.strictEqual(shorten('abcdef', 4), 'abc…');
  assert.strictEqual(shorten(null), '');
});
