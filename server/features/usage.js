const fs = require('node:fs');
const path = require('node:path');
const { REPO, PROJECTS_DIR, USAGE_DIR } = require('../config');
const { readJson } = require('../io/store');
const { jsonlFiles, readTail } = require('../io/files');
const { usageWorktree, latestLimits, tzOffsetMsOf, dayKeys, newUsageEntry, addUsageLines, newCodexEntry, addCodexLines, codexModelLabel, aggregateUsage } = require('../core/usage');
const { groupOrchestrations } = require('../core/usage-orchestration');
const { emptyTotals, addTotals } = require('../core/usage');
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
    if (!codex) entry.sessionId = path.basename(file, '.jsonl');
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
function codexUsage() {
  const entries = codexEntries(0).filter((e) => e.sessionId && e.at);
  const latest = entries.filter((e) => e.rateLimits).sort((a, b) => b.rateLimits.at - a.rateLimits.at)[0];
  return {
    limits: latest ? latest.rateLimits : null,
    sessions: entries.map((e) => ({ sessionId: e.sessionId, provider: 'codex', cwd: e.cwd, model: codexModelLabel(e.model), modelId: e.model, context: e.context, costUsd: null, at: e.at })),
  };
}

// Whole-transcript totals per session, with the statusline's cost when a snapshot has one.
function sessionUsageMap(entries, snapshots) {
  const costs = new Map(snapshots.map((u) => [u.sessionId, u.costUsd]));
  const map = new Map();
  for (const e of entries) {
    if (!e.sessionId) continue;
    const totals = emptyTotals();
    for (const day of e.days.values()) addTotals(totals, day);
    map.set(e.sessionId, { totals, costUsd: costs.get(e.sessionId) ?? null });
  }
  return map;
}

function usageHistory(tzOffsetMin) {
  const tzOffsetMs = tzOffsetMsOf(tzOffsetMin);
  if (historyCache && historyCache.tzOffsetMs === tzOffsetMs && Date.now() - historyCache.at < HISTORY_CACHE_TTL_MS) return historyCache.data;
  const keys = dayKeys(Date.now(), tzOffsetMs, USAGE_DAYS);
  const claude = jsonlFiles(PROJECTS_DIR, Date.now() - (USAGE_DAYS + 1) * 86400000).map(({ file, size }) => scanTranscript(file, size, tzOffsetMs));
  const codexAll = codexEntries(tzOffsetMs);
  const { days, worktrees } = aggregateUsage([...claude, ...codexAll], keys, REPO);
  const snapshots = readUsageSnapshots();
  const codex = codexUsage();
  const since = Date.now() - USAGE_DAYS * 86400000;
  const data = {
    generatedAt: Date.now(),
    limits: { claude: latestLimits(snapshots), codex: codex.limits },
    days,
    worktrees,
    orchestrations: groupOrchestrations(readStore(), sessionUsageMap([...claude, ...codexAll], snapshots), Date.now()),
    sessions: [...snapshots.map((u) => ({ ...u, provider: 'claude' })), ...codex.sessions.filter((s) => s.at >= since)]
      .sort((a, b) => b.at - a.at)
      .slice(0, USAGE_SESSIONS_MAX)
      .map((u) => ({ sessionId: u.sessionId, provider: u.provider, worktree: usageWorktree(u.cwd, REPO), model: u.model, context: u.context, costUsd: u.costUsd, at: u.at })),
  };
  historyCache = { at: Date.now(), tzOffsetMs, data };
  return data;
}

module.exports = { readUsageSnapshots, codexUsage, usageHistory };
