const fs = require('node:fs');
const path = require('node:path');
const { REPO, PROJECTS_DIR, USAGE_DIR } = require('../config');
const { readJson } = require('../io/store');
const { jsonlFiles, readTail } = require('../io/files');
const { totalOf, usageWorktree, latestLimits, tzOffsetMsOf, dayKeys, newUsageEntry, addUsageLines, newCodexEntry, addCodexLines, codexModelLabel, aggregateUsage, workSince } = require('../core/usage');
const { indexAction } = require('../core/session-index');
const { groupOrchestrations, transcriptSessionId, sessionUsageMap, withoutOrchestrated } = require('../core/usage-orchestration');
const { CODEX_SESSIONS_DIR } = require('./providers');
const { readStore } = require('./orchestration');

const USAGE_DAYS = 7;
const USAGE_SESSIONS_MAX = 30;
const HISTORY_CACHE_TTL_MS = 30000;
const transcriptUsage = new Map();
let historyCache = null;

function readUsageSnapshots() {
  let files = [];
  try {
    files = fs.readdirSync(USAGE_DIR).filter((f) => f.endsWith('.json'));
  } catch {}
  const since = Date.now() - USAGE_DAYS * 86400000;
  return files.map((f) => readJson(path.join(USAGE_DIR, f))).filter((u) => u?.sessionId && u.at >= since);
}

// Reads only the bytes appended since the last scan of each transcript or rollout.
function scanTranscript(file, size, tzOffsetMs, codex = false) {
  const key = `${tzOffsetMs}:${file}`;
  let entry = transcriptUsage.get(key);
  if (!entry || size < entry.offset) {
    entry = codex ? newCodexEntry(tzOffsetMs) : newUsageEntry(tzOffsetMs);
    if (!codex) entry.sessionId = transcriptSessionId(file);
  }
  if (size > entry.offset) {
    const buffer = readTail(file, entry.offset, size);
    const end = buffer.lastIndexOf(10);
    if (end >= 0) {
      entry.offset += end + 1;
      (codex ? addCodexLines : addUsageLines)(entry, buffer.subarray(0, end).toString('utf8'));
    }
  }
  transcriptUsage.set(key, entry);
  return entry;
}

const codexEntries = (tzOffsetMs) => jsonlFiles(CODEX_SESSIONS_DIR, Date.now() - (USAGE_DAYS + 1) * 86400000).map(({ file, size }) => scanTranscript(file, size, tzOffsetMs, true));

// GPT has no statusline: its limits, context and model come from the Codex rollouts.
function codexUsage(all = codexEntries(0)) {
  const entries = all.filter((e) => e.sessionId && e.at);
  const latest = entries.filter((e) => e.rateLimits).sort((a, b) => b.rateLimits.at - a.rateLimits.at)[0];
  return {
    limits: latest ? latest.rateLimits : null,
    sessions: entries.map((e) => ({ sessionId: e.sessionId, provider: 'codex', cwd: e.cwd, model: codexModelLabel(e.model), modelId: e.model, context: e.context, costUsd: null, at: e.at })),
  };
}

function usageHistory(tzOffsetMin) {
  const tzOffsetMs = tzOffsetMsOf(tzOffsetMin);
  if (historyCache && historyCache.tzOffsetMs === tzOffsetMs && Date.now() - historyCache.at < HISTORY_CACHE_TTL_MS) return historyCache.data;
  const keys = dayKeys(Date.now(), tzOffsetMs, USAGE_DAYS);
  const claude = jsonlFiles(PROJECTS_DIR, Date.now() - (USAGE_DAYS + 1) * 86400000).map(({ file, size }) => scanTranscript(file, size, tzOffsetMs));
  const codexAll = codexEntries(tzOffsetMs);
  const { days, worktrees } = aggregateUsage([...claude, ...codexAll], keys, REPO);
  const snapshots = readUsageSnapshots();
  const codex = codexUsage(codexAll);
  const since = Date.now() - USAGE_DAYS * 86400000;
  const orchestrations = groupOrchestrations(readStore(), sessionUsageMap([...claude, ...codexAll], snapshots), Date.now());
  const orchestratedIds = new Set(orchestrations.flatMap((g) => g.rows.map((r) => r.sessionId).filter(Boolean)));
  const sessions = withoutOrchestrated([...snapshots.map((u) => ({ ...u, provider: 'claude' })), ...codex.sessions.filter((s) => s.at >= since)].sort((a, b) => b.at - a.at), orchestratedIds, USAGE_SESSIONS_MAX);
  const data = {
    generatedAt: Date.now(),
    limits: { claude: latestLimits(snapshots), codex: codex.limits },
    days,
    worktrees,
    orchestrations,
    sessions: sessions.map((u) => ({ sessionId: u.sessionId, provider: u.provider, worktree: usageWorktree(u.cwd, REPO), model: u.model, context: u.context, costUsd: u.costUsd, at: u.at })),
  };
  historyCache = { at: Date.now(), tzOffsetMs, data };
  return data;
}

let sessionIndex = null;
let indexBuilding = false;

function buildSessionIndex() {
  const since = Date.now() - (USAGE_DAYS + 1) * 86400000;
  const files = [
    ...jsonlFiles(PROJECTS_DIR, since).map((f) => ({ ...f, codex: false })),
    ...jsonlFiles(CODEX_SESSIONS_DIR, since).map((f) => ({ ...f, codex: true })),
  ];
  const bySession = new Map();
  for (const { file, size, codex } of files) {
    const entry = scanTranscript(file, size, 0, codex);
    if (!entry.sessionId) continue;
    bySession.set(entry.sessionId, [...(bySession.get(entry.sessionId) || []), { file, codex }]);
  }
  sessionIndex = { at: Date.now(), bySession };
}

function rebuildSessionIndexLater() {
  indexBuilding = true;
  setImmediate(() => {
    try {
      buildSessionIndex();
    } catch (error) {
      console.error('session index failed', error);
    } finally {
      indexBuilding = false;
    }
  });
}

// Cumulated tokens of one session (sub-agent transcripts included, cache reads too): the measure of the usage views.
// The file index is built once on first use, then refreshed in the background at most once a minute; a request only re-reads the session's own transcripts.
function sessionTotals(sessionId) {
  if (!sessionId) return null;
  const action = indexAction({ builtAt: sessionIndex?.at ?? null, building: indexBuilding, now: Date.now() });
  if (action === 'build-now') buildSessionIndex();
  else if (action === 'rebuild-later') rebuildSessionIndexLater();
  const entries = (sessionIndex.bySession.get(sessionId) || []).flatMap(({ file, codex }) => {
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    return stat ? [scanTranscript(file, stat.size, 0, codex)] : [];
  });
  return sessionUsageMap(entries, []).get(sessionId)?.totals || null;
}

function sessionTokens(sessionId) {
  const totals = sessionTotals(sessionId);
  return totals ? totalOf(totals) : 0;
}

function providerWork(sinceMs) {
  const claude = jsonlFiles(PROJECTS_DIR, Date.now() - (USAGE_DAYS + 1) * 86400000).map(({ file, size }) => scanTranscript(file, size, 0));
  return { claude: workSince(claude, sinceMs.claude), codex: workSince(codexEntries(0), sinceMs.codex) };
}

const currentLimits = () => ({ claude: latestLimits(readUsageSnapshots()), codex: codexUsage().limits });

module.exports = { sessionTotals, sessionTokens, readUsageSnapshots, codexUsage, usageHistory, currentLimits, providerWork };
