const { CONFIG } = require('../config');
const { loadStore, saveStore } = require('../io/store');
const { invalidateSnapshot } = require('../cache');

const EVENTS_MAX = 200;
const eventsStore = loadStore('worktree-events.json', { seq: 0, events: [] });

function notifyExternal(event) {
  const url = CONFIG.notify?.ntfyUrl;
  const types = CONFIG.notify?.types || ['needs_input', 'permission', 'question', 'ci_failed', 'app_ko', 'migrations_failed'];
  if (!url || !types.includes(event.type)) return;
  fetch(url, { method: 'POST', body: event.message || event.type, headers: { Title: `Cockpit · ${event.worktree || ''}`.trim(), Tags: event.type } }).catch(() => {});
}

function pushEvent(event) {
  eventsStore.seq += 1;
  eventsStore.events.push({ id: eventsStore.seq, at: Date.now(), read: false, ...event });
  eventsStore.events = eventsStore.events.slice(-EVENTS_MAX);
  saveStore('worktree-events.json', eventsStore);
  notifyExternal(event);
}

function markEventsRead({ ids, all }) {
  const wanted = new Set((ids || []).map(Number));
  for (const e of eventsStore.events) if (all || wanted.has(e.id)) e.read = true;
  saveStore('worktree-events.json', eventsStore);
  invalidateSnapshot();
  return { ok: true };
}

const eventsSeq = () => eventsStore.seq;

const recentEvents = () => ({ events: eventsStore.events.slice(-100).reverse(), seq: eventsStore.seq });

module.exports = { pushEvent, markEventsRead, eventsSeq, recentEvents };
