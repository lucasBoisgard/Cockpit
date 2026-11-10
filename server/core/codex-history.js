const { parseCodexRollout } = require('./providers');
const path = require('node:path');

function inRepo(cwd, repo) {
  if (!cwd || !path.isAbsolute(cwd) || path.resolve(cwd) !== cwd) return false;
  return cwd === repo || cwd.startsWith(`${repo}${path.sep}`);
}

function codexHistoryMeta(text, file, mtimeMs) {
  let meta = null;
  let startedAt = null;
  for (const line of String(text).split('\n')) {
    let row;
    try { row = JSON.parse(line); } catch { continue; }
    if (row.type !== 'session_meta') continue;
    meta = row.payload || {};
    startedAt = Date.parse(row.timestamp) || null;
    break;
  }
  if (!meta?.id || !meta.cwd) return null;
  const chat = parseCodexRollout(text, meta.id);
  const messages = chat.items.filter((item) => item.kind === 'user' || item.kind === 'assistant');
  return { sessionId: meta.id, provider: 'codex', file, cwd: meta.cwd, branch: meta.git?.branch || null, title: messages.find((item) => item.kind === 'user')?.text.slice(0, 160) || null, messages: messages.length, files: [], startedAt, lastAt: mtimeMs };
}

module.exports = { codexHistoryMeta, inRepo };
