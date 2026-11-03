const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR, STATE_DIR, REVIEWS_DIR } = require('../config');

const SESSION_MAX_AGE_MS = 7 * 24 * 3600 * 1000;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

function loadStore(name, fallback) {
  return readJson(path.join(DATA_DIR, name)) ?? fallback;
}

function saveStore(name, data) {
  writeJsonAtomic(path.join(DATA_DIR, name), data);
}

function removeStore(name) {
  fs.rmSync(path.join(DATA_DIR, name), { force: true });
}

function readReview(name) {
  const meta = readJson(path.join(REVIEWS_DIR, `${name}.json`));
  const report = readJson(path.join(REVIEWS_DIR, `${name}.report.json`));
  if (!meta && !report) return null;
  return { pr: meta?.pr || report?.pr?.url || null, startedAt: meta?.startedAt || null, report: report && Array.isArray(report.blocks) ? report : null };
}

function writeSessionOverride(sessionId, fields) {
  writeJsonAtomic(path.join(STATE_DIR, `${sessionId}.server.json`), fields);
}

function readSession(sessionId) {
  if (!/^[\w-]+$/.test(sessionId)) return null;
  const session = readJson(path.join(STATE_DIR, `${sessionId}.json`));
  if (!session || Array.isArray(session)) return null;
  const override = readJson(path.join(STATE_DIR, `${sessionId}.server.json`));
  return override?.updatedAt > (session.updatedAt || 0) ? { ...session, ...override } : session;
}

function readSessions() {
  try {
    return fs
      .readdirSync(STATE_DIR)
      .filter((f) => /^[\w-]+\.json$/.test(f))
      .map((f) => readSession(f.slice(0, -5)))
      .filter((s) => s && s.cwd && Date.now() - s.updatedAt < SESSION_MAX_AGE_MS);
  } catch {
    return [];
  }
}

function sessionsIn(wtPath) {
  return readSessions().filter((s) => s.cwd === wtPath || s.cwd.startsWith(`${wtPath}/`));
}

module.exports = { readJson, loadStore, saveStore, removeStore, readReview, writeSessionOverride, readSession, readSessions, sessionsIn };
