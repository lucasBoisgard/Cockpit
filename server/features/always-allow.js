const { readSession } = require('../io/store');
const { sendOps } = require('./terminal');
const { cycleSessionMode } = require('./agent-mode');
const { switchTeamToAuto } = require('./orchestration');
const { PROVIDERS } = require('../core/providers');

// "Toujours autoriser": answers the permission prompt, then puts the session in auto mode so that it stops asking.
// A member of an orchestration takes its whole team along (an agent is never looser than its orchestration);
// any other session is walked to auto with Shift+Tab once its turn is over.
const FINAL = ['applied', 'unchanged', 'unreachable', 'offline', 'failed'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Built around injectable I/O so that the flow can be tested without tmux.
function createAlwaysAllow({ readSession, sendOps, cycleSessionMode, switchTeamToAuto, allowKey, retryMs = 1000, giveUpMs = 10 * 60 * 1000 }) {
  const waiting = new Set();
  const asking = (session) => session?.status === 'needs_input' && !!session.permission;
  const gone = (session) => !session || session.status === 'ended';

  // The allowed command may run for minutes and the hooks report nothing until it ends: switching the team before the
  // prompt is cleared would relaunch (kill) this very session. Waits until it no longer asks, or gives up.
  async function promptCleared(sessionId) {
    const deadline = Date.now() + giveUpMs;
    while (Date.now() < deadline) {
      const session = readSession(sessionId);
      if (gone(session)) return false;
      if (!asking(session)) return true;
      await sleep(retryMs);
    }
    return false;
  }

  async function sessionToAuto(sessionId) {
    const deadline = Date.now() + giveUpMs;
    while (Date.now() < deadline) {
      if (gone(readSession(sessionId))) return 'offline';
      const outcome = await cycleSessionMode(sessionId, 'auto');
      if (FINAL.includes(outcome)) return outcome;
      await sleep(retryMs);
    }
    return 'timeout';
  }

  async function switchToAuto(sessionId) {
    if (!(await promptCleared(sessionId))) return 'skipped';
    if (await switchTeamToAuto(sessionId)) return 'team';
    if (waiting.has(sessionId)) return 'already';
    waiting.add(sessionId);
    try {
      return await sessionToAuto(sessionId);
    } finally {
      waiting.delete(sessionId);
    }
  }

  // `target`: the tmux target of the session that asks, `sessionId`: the session itself.
  // `done` is called with the outcome of the switch, which runs once the prompt is answered.
  return async function alwaysAllow({ target, sessionId, done = () => {} }) {
    const id = String(sessionId || '');
    const session = readSession(id);
    if (!session) return { error: 'Session inconnue.' };
    if (session.provider === 'codex') return { error: 'Codex a son propre « Toujours autoriser ».' };
    if (!asking(session)) return { error: 'Aucune permission en attente pour cette session.' };
    const sent = await sendOps(target, [allowKey]);
    if (sent.error) return sent;
    switchToAuto(id).then(done, () => done('error'));
    return { ok: true };
  };
}

const alwaysAllow = createAlwaysAllow({ readSession, sendOps, cycleSessionMode, switchTeamToAuto, allowKey: PROVIDERS.claude.keys.allow });

module.exports = { alwaysAllow, createAlwaysAllow };
