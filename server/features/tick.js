const { TICK_MS } = require('../config');
const { loadStore, readSession } = require('../io/store');
const { sessionEvent, delegatedDoneText, turnStatus } = require('../core/sessions');
const { appWentKo } = require('../core/app');
const { invalidateSnapshot } = require('../cache');
const { listWorktrees } = require('./worktrees');
const { snapshot } = require('./snapshot');
const { pushEvent } = require('./events');
const { enqueue, flushQueues } = require('./queue');
const { migrateIfPulled } = require('./app');
const { prRefreshDue, refreshPrs } = require('./pr');
const { runDueAutomations } = require('./automations');
const { onSessionEvent, checkLostAgents } = require('./orchestration');
const { cutArenaIfOverLimit } = require('./arena-breaker');
const { publishMatrixIfDue } = require('./matrix-publish');

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
      const live = { ...session, status: turnStatus(session) };
      lastStatus.set(session.sessionId, live.status);
      const event = sessionEvent(before, live);
      if (!event) continue;
      pushEvent({ worktree: wt.name, path: wt.path, sessionId: session.sessionId, ...event });
      try {
        onSessionEvent(session.sessionId, event, session);
      } catch (error) {
        console.error('orchestration wake failed', error);
      }
      const link = links[wt.name];
      const first = wt.sessions.reduce((a, b) => (b.startedAt < a.startedAt ? b : a));
      if (event.type === 'done' && link?.notify && first.sessionId === session.sessionId && readSession(link.parentSessionId)) enqueue(link.parentSessionId, delegatedDoneText(wt.name, session.lastAssistant));
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
    await checkLostAgents().catch((error) => console.error('orchestration check failed', error));
    await cutArenaIfOverLimit().catch((error) => console.error('arena breaker failed', error));
    await flushQueues(snap, (sessionId) => lastStatus.set(sessionId, 'working'));
    migrateIfPulled(snap.app).catch((error) => console.error('migrations failed', error));
    if (prRefreshDue()) refreshPrs(await listWorktrees()).catch(() => {});
    publishMatrixIfDue().catch((error) => console.error('matrix publish check failed', error));
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
