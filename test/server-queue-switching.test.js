const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-queue-switching-'));
process.env.HOME = home;
const stateDir = path.join(home, '.claude', 'worktree-state');
fs.mkdirSync(stateDir, { recursive: true });
const cycle = ['default', 'acceptEdits', 'plan', 'auto'];
const FOOTERS = { default: '? for shortcuts', acceptEdits: '⏵⏵ accept edits on', plan: '⏸ plan mode on', auto: '⏵⏵ auto mode on' };
const state = { index: 0, calls: [], onPress: null };
require('../server/io/exec').tmux = async (args) => {
  state.calls.push(args);
  if (args[0] === 'capture-pane') return { ok: true, stdout: `❯ \n  ${FOOTERS[cycle[state.index]]}`, stderr: '' };
  if (args[0] === 'send-keys' && args.includes('BTab')) {
    state.index = (state.index + 1) % cycle.length;
    if (state.onPress) await state.onPress();
  }
  return { ok: true, stdout: '', stderr: '' };
};
// patched before the features that destructure it
require('../server/features/worktrees').livePanes = async () => new Map([['%900009', { session: 'x', created: 0 }]]);
const { deliver, flushQueues, loadQueues } = require('../server/features/queue');
const { cycleSessionMode } = require('../server/features/agent-mode');
const { sendMessage } = require('../server/features/routing');

test.after(() => fs.rmSync(home, { recursive: true, force: true }));

const writeState = (status) => fs.writeFileSync(path.join(stateDir, 's1.json'), JSON.stringify({ sessionId: 's1', cwd: home, status, updatedAt: Date.now(), startedAt: 1, tmuxPane: '%900009' }));

test('no message reaches a session while it is walked through the mode cycle', async () => {
  writeState('done');
  let first = true;
  state.onPress = async () => {
    if (!first) return;
    first = false;
    assert.strictEqual(await deliver('s1', 'while switching', true), 'queued');
    await flushQueues({ worktrees: [{ sessions: [{ sessionId: 's1', live: true, stale: false, status: 'done' }] }] }, () => {});
  };
  assert.strictEqual(await cycleSessionMode('s1', 'plan'), 'applied');
  assert.deepStrictEqual(state.calls.filter((c) => c[0] === 'paste-buffer' || c[0] === 'load-buffer'), []);
  assert.strictEqual(loadQueues().s1.length, 1);
  state.onPress = null;
  await flushQueues({ worktrees: [{ sessions: [{ sessionId: 's1', live: true, stale: false, status: 'done' }] }] }, () => {});
  assert.ok(state.calls.some((c) => c[0] === 'paste-buffer'));
  assert.strictEqual(loadQueues().s1, undefined);
});

test('the composer queues its message while the session is being walked through the cycle', async () => {
  fs.rmSync(path.join(home, '.claude', 'worktree-queue.json'), { force: true });
  state.calls.length = 0;
  state.index = 0;
  writeState('done');
  let routed;
  let first = true;
  state.onPress = async () => {
    if (!first) return;
    first = false;
    routed = await sendMessage({ target: 's1', text: 'from the composer' });
  };
  assert.strictEqual(await cycleSessionMode('s1', 'plan'), 'applied');
  assert.deepStrictEqual(routed, { route: 'queued' });
  assert.deepStrictEqual(state.calls.filter((c) => c[0] === 'paste-buffer' || c[0] === 'load-buffer'), []);
  assert.strictEqual(loadQueues().s1[0].text, 'from the composer');
});
