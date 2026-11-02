const crypto = require('node:crypto');
const { loadStore, saveStore } = require('../io/store');
const { normalizeAutomation, nextRunOf, automationDue, automationWorktree } = require('../core/automations');
const { startSession } = require('./sessions');
const { pushEvent } = require('./events');

const STORE = 'worktree-automations.json';

const loadAutomations = () => loadStore(STORE, []);

function saveAutomation({ item }) {
  const list = loadAutomations();
  const normalized = normalizeAutomation(item, list, crypto.randomBytes(4).toString('hex'), Date.now());
  if (normalized.error) return normalized;
  const { automation } = normalized;
  saveStore(STORE, [...list.filter((a) => a.id !== automation.id), automation]);
  return { ok: true, id: automation.id };
}

function deleteAutomation({ id }) {
  saveStore(STORE, loadAutomations().filter((a) => a.id !== id));
  return { ok: true };
}

function listAutomations() {
  const now = Date.now();
  return loadAutomations().map((a) => ({ ...a, nextRun: nextRunOf(a, now) }));
}

async function runAutomation(id) {
  const list = loadAutomations();
  const a = list.find((x) => x.id === id);
  if (!a) return { error: 'Automatisation inconnue.' };
  const worktree = automationWorktree(a, Date.now());
  const result = await startSession({ worktree, prompt: a.prompt });
  a.lastRun = Date.now();
  a.lastWorktree = result.error ? null : worktree;
  a.lastOk = !result.error;
  a.lastResult = result.error ? `Échec : ${result.error}` : `Lancée dans ${worktree}`;
  saveStore(STORE, list);
  pushEvent({ type: result.error ? 'automation_failed' : 'automation', worktree, message: `${a.name} : ${a.lastResult}` });
  return result.error ? result : { ok: true, worktree };
}

async function runDueAutomations() {
  const now = Date.now();
  for (const a of loadAutomations()) if (automationDue(a, now)) await runAutomation(a.id);
}

module.exports = { saveAutomation, deleteAutomation, listAutomations, runAutomation, runDueAutomations };
