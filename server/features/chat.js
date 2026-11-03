const fs = require('node:fs');
const path = require('node:path');
const { PROJECTS_DIR } = require('../config');
const { readSession } = require('../io/store');
const { parseChat } = require('../core/transcript');

function transcriptFor(session) {
  if (!session) return null;
  const candidates = [session.transcriptPath, path.join(PROJECTS_DIR, session.cwd.replace(/[^a-zA-Z0-9]/g, '-'), `${session.sessionId}.jsonl`)];
  return candidates.find((p) => p && path.resolve(p).startsWith(`${PROJECTS_DIR}/`) && fs.existsSync(p)) || null;
}

function readChatFile(file, sessionId) {
  return parseChat(fs.readFileSync(file, 'utf8'), sessionId);
}

function readChat(sessionId) {
  const file = transcriptFor(readSession(sessionId));
  return file ? readChatFile(file, sessionId) : null;
}

module.exports = { transcriptFor, readChat, readChatFile };
