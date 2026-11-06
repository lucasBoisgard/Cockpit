const { sleep } = require('../io/exec');
const { readSession, loadStore } = require('../io/store');
const { paneOf } = require('../core/sessions');
const core = require('../core/permission-mode');
const { livePanes } = require('./worktrees');
const { screen, sendOps } = require('./terminal');

const SETTLE_MS = 500;

// Switches an idle Claude Code prompt to `target` with Shift+Tab, one press at a time. The footer is read
// before every press and `idle` is checked right before it: in a dialog Shift+Tab confirms the choice, so
// nothing is pressed once the prompt is not idle or shows no mode.
function cyclePaneMode(pane, target, idle = async () => true) {
  return core.cycleToMode({
    read: async () => core.modeFromScreen(await screen(pane)),
    idle,
    press: async () => {
      await sendOps(pane, [{ key: 'BTab' }]);
      await sleep(SETTLE_MS);
    },
  }, target);
}

const idleSession = (sessionId) => async () => ['done', 'idle'].includes(readSession(sessionId)?.status);

// Sessions being walked through the cycle: no queued message is sent to them meanwhile, it would start a
// turn in an intermediate mode.
const switching = new Set();
const isSwitching = (sessionId) => switching.has(sessionId);
const hasQueued = (sessionId) => (loadStore('worktree-queue.json', {})[sessionId] || []).length > 0;

// A session with a message waiting is left for the end of its next turn: that message would start a turn
// halfway through the walk.
async function cycleSessionMode(sessionId, target) {
  const id = String(sessionId || '');
  const session = readSession(id);
  if (!['done', 'idle'].includes(session?.status)) return session ? 'busy' : 'offline';
  if (hasQueued(id)) return 'busy';
  const pane = paneOf(session, await livePanes());
  if (!pane) return 'offline';
  switching.add(id);
  try {
    return await cyclePaneMode(pane, target, idleSession(id));
  } finally {
    switching.delete(id);
  }
}

const timing = { attempts: 40, gapMs: 1000 };

// Where a freshly launched session shows its mode once its prompt is up; null when it never did.
async function modeShownBy(tmuxName) {
  for (let i = 0; i < timing.attempts; i++) {
    const shown = core.modeFromScreen(await screen(`${tmuxName}:`));
    if (shown) return shown;
    await sleep(timing.gapMs);
  }
  return null;
}

module.exports = { cyclePaneMode, cycleSessionMode, isSwitching, modeShownBy, timing };
