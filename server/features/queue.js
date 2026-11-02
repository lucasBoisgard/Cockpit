const crypto = require('node:crypto');
const { loadStore, saveStore, readSession, writeSessionState } = require('../io/store');
const { paneOf, withClaudeStatus, shouldQueue } = require('../core/sessions');
const { invalidateSnapshot } = require('../cache');
const { livePanes } = require('./worktrees');
const { submitText } = require('./terminal');

const STALE_MS = 30 * 60 * 1000;

const loadQueues = () => loadStore('worktree-queue.json', {});

async function sendToSession(sessionId, text) {
  const pane = paneOf(readSession(String(sessionId || '')), await livePanes());
  if (!pane) return false;
  await submitText(pane, text);
  return true;
}

function enqueue(sessionId, text) {
  const queues = loadQueues();
  const item = { id: crypto.randomBytes(4).toString('hex'), text: String(text), at: Date.now() };
  queues[sessionId] = [...(queues[sessionId] || []), item];
  saveStore('worktree-queue.json', queues);
  invalidateSnapshot();
  return item;
}

function dequeue(sessionId, id) {
  const queues = loadQueues();
  queues[sessionId] = (queues[sessionId] || []).filter((item) => item.id !== id);
  if (!queues[sessionId].length) delete queues[sessionId];
  saveStore('worktree-queue.json', queues);
  invalidateSnapshot();
  return { ok: true };
}

async function deliver(sessionId, text, queueWhenWaiting = false) {
  const panes = await livePanes();
  const raw = readSession(String(sessionId || ''));
  if (!raw) return 'unknown';
  if (!paneOf(raw, panes)) return 'offline';
  const session = withClaudeStatus(raw, panes);
  if (shouldQueue(session, queueWhenWaiting, Date.now(), STALE_MS)) {
    enqueue(session.sessionId, text);
    return 'queued';
  }
  return (await sendToSession(session.sessionId, text)) ? 'sent' : 'offline';
}

async function broadcast({ targets, text }) {
  const message = String(text || '').trim();
  if (!message || !Array.isArray(targets) || !targets.length) return { error: 'Message ou sessions manquants.' };
  const report = { sent: [], queued: [], offline: [] };
  for (const target of targets.slice(0, 50)) {
    const outcome = await deliver(target, message, true);
    (report[outcome] || report.offline).push(target);
  }
  return report;
}

async function flushQueues(snap, onSent) {
  const queues = loadQueues();
  for (const wt of snap.worktrees) {
    for (const session of wt.sessions) {
      const items = queues[session.sessionId];
      if (!items?.length || !session.live || !['done', 'idle'].includes(session.status)) continue;
      const [first] = items;
      if (!(await sendToSession(session.sessionId, first.text))) continue;
      dequeue(session.sessionId, first.id);
      const now = Date.now();
      writeSessionState({ ...readSession(session.sessionId), status: 'working', updatedAt: now, statusSince: now, turnStartedAt: now, workedMs: session.workedMs });
      onSent(session.sessionId);
    }
  }
}

module.exports = { loadQueues, enqueue, dequeue, deliver, broadcast, flushQueues };
