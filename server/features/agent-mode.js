const { sleep } = require('../io/exec');
const { readSession } = require('../io/store');
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

async function cycleSessionMode(sessionId, target) {
  const id = String(sessionId || '');
  const session = readSession(id);
  if (!['done', 'idle'].includes(session?.status)) return session ? 'busy' : 'offline';
  const pane = paneOf(session, await livePanes());
  return pane ? cyclePaneMode(pane, target, idleSession(id)) : 'offline';
}

module.exports = { cyclePaneMode, cycleSessionMode };
