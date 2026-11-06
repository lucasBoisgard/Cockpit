const { execFile } = require('node:child_process');
const { CLAUDE_BIN } = require('../config');
const { readSession } = require('../io/store');
const { paneOf, withClaudeStatus, ownerOf } = require('../core/sessions');
const core = require('../core/routing');
const { listWorktrees, worktreeName, livePanes } = require('./worktrees');
const { enqueue, sendToSession } = require('./queue');
const { startSession } = require('./sessions');
const { isSwitching } = require('./agent-mode');

const DECIDE_TIMEOUT_MS = 12000;

// A small model reads the message against what the session is doing. Any failure keeps it in the session.
function decide(session, message) {
  const args = ['-p', '--model', 'haiku', '--no-session-persistence', '--tools', '', '--strict-mcp-config', '--output-format', 'json'];
  return new Promise((resolve) => {
    const child = execFile(CLAUDE_BIN, args, { timeout: DECIDE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, COCKPIT_HIDDEN: '1' } }, (error, stdout) => {
      let result = null;
      try {
        const parsed = JSON.parse(stdout);
        result = (Array.isArray(parsed) ? parsed.findLast((e) => e.type === 'result') : parsed)?.result;
      } catch {}
      resolve(result ? core.parseRoute(result) : { route: 'session', reason: null });
    });
    child.stdin.end(core.routePrompt({ task: session.lastPrompt || session.task, lastAssistant: session.lastAssistant, actions: session.actions, message }));
  });
}

// The composer's single send: to the session (taken into account during its turn, like the CLI), held
// until a pending question or permission is answered, or to a new session in the same worktree when the
// message is an independent task.
async function sendMessage({ target, text }) {
  const message = String(text || '').trim();
  const raw = readSession(String(target || ''));
  if (!raw || !message) return { error: 'Session ou message manquant.' };
  const panes = await livePanes();
  if (!paneOf(raw, panes)) return { error: 'Cette session ne tourne pas dans tmux, le cockpit ne peut pas lui écrire.' };
  const session = withClaudeStatus(raw, panes);
  if (isSwitching(session.sessionId)) {
    enqueue(session.sessionId, message);
    return { route: 'queued' };
  }
  const quick = core.quickRoute(session.status, message);
  if (quick === 'queue') {
    enqueue(session.sessionId, message);
    return { route: 'queued' };
  }
  const decision = quick === 'session' ? { route: 'session', reason: null } : await decide(session, message);
  if (decision.route === 'parallel') {
    const owner = ownerOf(session.cwd, await listWorktrees());
    const started = owner ? await startSession({ worktree: worktreeName(owner.path), prompt: message }) : { error: 'Worktree introuvable.' };
    if (!started.error) return { route: 'parallel', reason: decision.reason, session: started.session };
  }
  if (!(await sendToSession(session.sessionId, message))) return { error: 'Cette session ne tourne pas dans tmux, le cockpit ne peut pas lui écrire.' };
  return { route: 'session', reason: decision.reason, during: session.status === 'working' };
}

module.exports = { sendMessage };
