const { readSession } = require('../io/store');
const { screen, sendOps, sendNamedKeys } = require('./terminal');
const { answerOps } = require('../core/permission-dialog');

const UNKNOWN = 'Dialogue non reconnu : réponds dans le terminal.';

// Answers the approval dialog of a Claude session by what its screen shows (core/permission-dialog.js). It only presses keys
// for a session that is really asking for a permission and a dialog it recognizes; otherwise it refuses and presses nothing.
function createPermissionAnswer({ readSession, screen, sendOps, sendNamedKeys }) {
  return async function answerPermission({ target, sessionId, decision }) {
    const session = readSession(String(sessionId || ''));
    if (!session) return { error: 'Session inconnue.' };
    if (session.provider === 'codex') return { error: 'Codex répond par ses propres boutons.' };
    if (session.status !== 'needs_input' || !session.permission) return { error: 'Aucune permission en attente pour cette session.' };
    const text = await screen(target);
    const ops = text === null ? null : answerOps(text, decision);
    if (!ops) return { error: UNKNOWN };
    return ops.every((op) => op.key) ? sendNamedKeys(target, ops.map((op) => op.key)) : sendOps(target, ops);
  };
}

const answerPermission = createPermissionAnswer({ readSession, screen, sendOps, sendNamedKeys });

module.exports = { answerPermission, createPermissionAnswer };
