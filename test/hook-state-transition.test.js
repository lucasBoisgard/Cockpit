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

test('resuming a session killed mid-turn starts idle and counts the turn up to its last activity', () => {
  const state = replay([start, prompt(2000), tool(5000), [90000, { hook_event_name: 'SessionStart', source: 'resume' }]]);
  assert.strictEqual(state.status, 'idle');
  assert.strictEqual(state.workedMs, 3000);
  assert.strictEqual(state.statusSince, 90000);
});

test('a compaction during a turn keeps the session working', () => {
  const state = replay([start, prompt(2000), tool(5000), [6000, { hook_event_name: 'SessionStart', source: 'compact' }]]);
  assert.strictEqual(state.status, 'working');
  assert.strictEqual(state.statusSince, 2000);
});

const subTool = (now) => [now, { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, agent_id: 'a1' }];

test('a subagent tool call after the main turn ended changes nothing', () => {
  const state = replay([start, prompt(2000), stop(3000)]);
  const [now, input] = subTool(4000);
  assert.strictEqual(applyHookEvent(state, { session_id: 's', ...input }, { now, pane: '%1', fallbackCwd: '/fallback' }), false);
  assert.deepStrictEqual([state.status, state.actions.length], ['done', 0]);
});

test('a subagent tool call keeps a working session fresh without showing as its action', () => {
  const state = replay([start, prompt(2000), tool(2500), subTool(9000)]);
  assert.deepStrictEqual([state.status, state.updatedAt, state.statusSince, state.actions.length], ['working', 9000, 2000, 1]);
});

test('a subagent tool call after an allowed permission brings the session back to working', () => {
  const state = replay([start, prompt(2000), [3000, { hook_event_name: 'Notification', message: 'Claude needs your permission to use Bash' }], subTool(5000)]);
  assert.deepStrictEqual([state.status, state.permission, state.message, state.statusSince], ['working', false, null, 5000]);
});

test('edited folders are remembered, most recent first, for the main agent and its subagents', () => {
  const edit = (now, file, extra = {}) => [now, { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file }, ...extra }];
  const state = replay([start, prompt(2000), edit(3000, '/other/repo/a.js'), edit(4000, 'src/b.js'), edit(5000, '/other/repo/c.js'), stop(6000)]);
  assert.deepStrictEqual(state.editedDirs, ['/other/repo', '/repo/src']);
  const [now, input] = edit(7000, '/third/x.md', { agent_id: 'a1' });
  assert.strictEqual(applyHookEvent(state, { session_id: 's', ...input }, { now, pane: '%1', fallbackCwd: '/fallback' }), true);
  assert.deepStrictEqual([state.status, state.editedDirs[0]], ['done', '/third']);
  const [later, again] = edit(8000, '/third/y.md', { agent_id: 'a1' });
  assert.strictEqual(applyHookEvent(state, { session_id: 's', ...again }, { now: later, pane: '%1', fallbackCwd: '/fallback' }), false);
});

test('edited folders cover notebooks, stay unique and keep the 20 most recent', () => {
  const events = [start, prompt(2000), [2500, { hook_event_name: 'PreToolUse', tool_name: 'NotebookEdit', tool_input: { notebook_path: '/nb/x.ipynb' } }]];
  for (let i = 0; i < 25; i++) events.push([3000 + i, { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: `/d${i}/f.txt` } }]);
  const state = replay(events);
  assert.deepStrictEqual([state.editedDirs.length, state.editedDirs[0], state.editedDirs.includes('/nb')], [20, '/d24', false]);
});

test('a subagent edit after the main turn keeps the session updatedAt and needs an existing state', () => {
  const state = replay([start, prompt(2000), stop(3000)]);
  const input = { session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/x/y.js' }, agent_id: 'a1' };
  assert.strictEqual(applyHookEvent(state, input, { now: 9000, pane: '%1', fallbackCwd: '/fallback' }), true);
  assert.strictEqual(state.updatedAt, 3000);
  assert.strictEqual(applyHookEvent({ actions: [] }, input, { now: 9000, pane: '%1', fallbackCwd: '/fallback' }), false);
});

const codexOpts = { now: 1000, pane: '%9', fallbackCwd: '/repo', provider: 'codex' };

test('codex sessions are tagged and their apply_patch edits are tracked', () => {
  const state = { actions: [] };
  applyHookEvent(state, { session_id: 'c1', cwd: '/repo', hook_event_name: 'SessionStart', source: 'startup' }, codexOpts);
  assert.strictEqual(state.provider, 'codex');
  applyHookEvent(state, { session_id: 'c1', cwd: '/repo', hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: '*** Begin Patch\n*** Update File: web/a.js\n@@\n-x\n+y\n*** End Patch' } }, { ...codexOpts, now: 2000 });
  assert.strictEqual(state.status, 'working');
  assert.deepStrictEqual(state.actions[0], { tool: 'apply_patch', detail: 'web/a.js', at: 2000 });
  assert.deepStrictEqual(state.editedDirs, ['/repo/web']);
});

test('a codex approval request waits for the user until the tool runs', () => {
  const state = { actions: [], status: 'working', statusSince: 0, updatedAt: 0 };
  applyHookEvent(state, { session_id: 'c1', cwd: '/repo', hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'git push' } }, codexOpts);
  assert.strictEqual(state.status, 'needs_input');
  assert.strictEqual(state.permission, true);
  assert.strictEqual(state.message, 'Permission : Bash · git push');
  assert.strictEqual(applyHookEvent(state, { session_id: 'c1', cwd: '/repo', hook_event_name: 'PostToolUse', tool_name: 'Bash' }, { ...codexOpts, now: 3000 }), true);
  assert.strictEqual(state.status, 'working');
  assert.strictEqual(applyHookEvent(state, { session_id: 'c1', cwd: '/repo', hook_event_name: 'PostToolUse', tool_name: 'Bash' }, { ...codexOpts, now: 4000 }), false);
  applyHookEvent(state, { session_id: 'c1', cwd: '/repo', hook_event_name: 'Interrupt' }, { ...codexOpts, now: 5000 });
  assert.strictEqual(state.status, 'idle');
});

test('the notification that follows a question does not turn it into a permission', () => {
  const state = { actions: [] };
  const opts = { now: 1, pane: '%1', fallbackCwd: '/r' };
  applyHookEvent(state, { session_id: 'x', cwd: '/r', hook_event_name: 'PreToolUse', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Couleur ?', options: [{ label: 'Rouge' }, { label: 'Bleu' }] }] } }, opts);
  assert.strictEqual(applyHookEvent(state, { session_id: 'x', cwd: '/r', hook_event_name: 'Notification', message: 'Claude needs your permission to use AskUserQuestion' }, opts), false);
  assert.strictEqual(state.permission, undefined);
  assert.strictEqual(state.message, 'Couleur ?');
  assert.strictEqual(state.questions[0].options[1].label, 'Bleu');
});
