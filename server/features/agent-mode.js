const { sleep } = require('../io/exec');
const { readSession } = require('../io/store');
const { paneOf } = require('../core/sessions');
const core = require('../core/permission-mode');
const { livePanes } = require('./worktrees');
const { screen, sendOps } = require('./terminal');

const PRESS_GAP_MS = 80;
const SETTLE_MS = 600;
const ROUNDS = 3;

const readPaneMode = async (pane) => core.modeFromScreen(await screen(pane));

// Switches a live Claude Code prompt to `target` with Shift+Tab, as the user would. The presses go out
// in one quick burst so the intermediate modes of the cycle last a few milliseconds, and the footer is
// read back after each round: nothing more is pressed once it no longer shows a mode (a dialog opened).
async function cyclePaneMode(pane, target) {
  let current = await readPaneMode(pane);
  for (let round = 0; round < ROUNDS; round++) {
    if (!current) return 'unreadable';
    if (current === target) return round ? 'applied' : 'unchanged';
    const presses = core.cyclePresses(current, target);
    if (presses === null) return 'unreachable';
    for (let i = 0; i < presses; i++) {
      await sendOps(pane, [{ key: 'BTab' }]);
      await sleep(PRESS_GAP_MS);
    }
    await sleep(SETTLE_MS);
    current = await readPaneMode(pane);
  }
  return current === target ? 'applied' : 'failed';
}

async function cycleSessionMode(sessionId, target) {
  const pane = paneOf(readSession(String(sessionId || '')), await livePanes());
  return pane ? cyclePaneMode(pane, target) : 'offline';
}

module.exports = { cyclePaneMode, cycleSessionMode };
