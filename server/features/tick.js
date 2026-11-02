const { TICK_MS } = require('../config');
const { loadStore, readSession } = require('../io/store');
const { sessionEvent, delegatedDoneText } = require('../core/sessions');
const { appWentKo } = require('../core/app');
const { invalidateSnapshot } = require('../cache');
const { listWorktrees } = require('./worktrees');
const { snapshot } = require('./snapshot');
const { pushEvent } = require('./events');
const { enqueue, flushQueues } = require('./queue');
const { migrateIfPulled } = require('./app');
const { prRefreshDue, refreshPrs } = require('./pr');
const { runDueAutomations } = require('./automations');

const AUTOMATION_CHECK_MS = 30000;
const lastStatus = new Map();
let lastAppState = null;
let ticking = false;
let lastAutomationCheck = 0;

function detectTransitions(snap) {
  const links = loadStore('worktree-links.json', {});
  for (const wt of snap.worktrees) {
    for (const session of wt.sessions) {
      const before = lastStatus.get(session.sessionId);
      const live = session.stale ? { ...session, status: 'working' } : session;
      lastStatus.set(session.sessionId, live.status);
      const event = sessionEvent(before, live);
      if (!event) continue;
      pushEvent({ worktree: wt.name, path: wt.path, sessionId: session.sessionId, ...event });
      const link = links[wt.name];
      if (event.type === 'done' && link?.notify && readSession(link.parentSessionId)) enqueue(link.parentSessionId, delegatedDoneText(wt.name, session.lastAssistant));
    }
  }
  const appNow = snap.app?.state || null;
  if (appWentKo(lastAppState, appNow)) pushEvent({ type: 'app_ko', worktree: 'app', message: snap.app.reason || "L'app est KO" });
  lastAppState = appNow;
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    invalidateSnapshot();
    const snap = await snapshot();
    detectTransitions(snap);
    await flushQueues(snap, (sessionId) => lastStatus.set(sessionId, 'working'));
    migrateIfPulled(snap.app).catch((error) => console.error('migrations failed', error));
    if (prRefreshDue()) refreshPrs(await listWorktrees()).catch(() => {});
    if (Date.now() - lastAutomationCheck > AUTOMATION_CHECK_MS) {
      lastAutomationCheck = Date.now();
      await runDueAutomations();
    }
  } catch (error) {
    console.error('tick failed', error);
  } finally {
    ticking = false;
  }
}

function startTicking() {
  tick();
  setInterval(tick, TICK_MS);
}

module.exports = { startTicking };
