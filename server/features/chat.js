const fs = require('node:fs');
const path = require('node:path');
const { PROJECTS_DIR } = require('../config');
const { readSession } = require('../io/store');
const { parseChat } = require('../core/transcript');
const { parseCodexRollout } = require('../core/providers');
const { CODEX_SESSIONS_DIR } = require('./providers');

function transcriptFor(session) {
  if (!session) return null;
  if (session.provider === 'codex') {
    const file = session.transcriptPath && path.resolve(session.transcriptPath);
    return file && file.startsWith(`${CODEX_SESSIONS_DIR}/`) && fs.existsSync(file) ? file : null;
  }
  const candidates = [session.transcriptPath, path.join(PROJECTS_DIR, session.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${session.sessionId}.jsonl`)];
  return candidates.find((p) => p && path.resolve(p).startsWith(`${PROJECTS_DIR}/`) && fs.existsSync(p)) || null;
}

function readChatFile(file, sessionId) {
  return parseChat(fs.readFileSync(file, 'utf8'), sessionId);
}

function readChat(sessionId) {
  const session = readSession(sessionId);
  const file = transcriptFor(session);
  if (!file) return null;
  return session.provider === 'codex' ? parseCodexRollout(fs.readFileSync(file, 'utf8'), sessionId) : readChatFile(file, sessionId);
}

module.exports = { transcriptFor, readChat, readChatFile };
