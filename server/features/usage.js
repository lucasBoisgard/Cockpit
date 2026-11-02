const fs = require('node:fs');
const path = require('node:path');
const { REPO, PROJECTS_DIR, USAGE_DIR } = require('../config');
const { readJson } = require('../io/store');
const { jsonlFiles, readTail } = require('../io/files');
const { usageWorktree, latestLimits, tzOffsetMsOf, dayKeys, newUsageEntry, addUsageLines, aggregateUsage } = require('../core/usage');

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

function scanTranscript(file, size, tzOffsetMs) {
  let entry = transcriptUsage.get(file);
  if (!entry || size < entry.offset || entry.tzOffsetMs !== tzOffsetMs) entry = newUsageEntry(tzOffsetMs);
  if (size > entry.offset) {
    const buffer = readTail(file, entry.offset, size);
    const end = buffer.lastIndexOf(10);
    if (end >= 0) {
      entry.offset += end + 1;
      addUsageLines(entry, buffer.subarray(0, end).toString('utf8'));
    }
  }
  transcriptUsage.set(file, entry);
  return entry;
}

function usageHistory(tzOffsetMin) {
  const tzOffsetMs = tzOffsetMsOf(tzOffsetMin);
  if (historyCache && historyCache.tzOffsetMs === tzOffsetMs && Date.now() - historyCache.at < HISTORY_CACHE_TTL_MS) return historyCache.data;
  const keys = dayKeys(Date.now(), tzOffsetMs, USAGE_DAYS);
  const entries = jsonlFiles(PROJECTS_DIR, Date.now() - (USAGE_DAYS + 1) * 86400000).map(({ file, size }) => scanTranscript(file, size, tzOffsetMs));
  const { days, worktrees } = aggregateUsage(entries, keys, REPO);
  const snapshots = readUsageSnapshots();
  const data = {
    generatedAt: Date.now(),
    limits: latestLimits(snapshots),
    days,
    worktrees,
    sessions: snapshots
      .sort((a, b) => b.at - a.at)
      .slice(0, USAGE_SESSIONS_MAX)
      .map((u) => ({ sessionId: u.sessionId, worktree: usageWorktree(u.cwd, REPO), model: u.model, context: u.context, costUsd: u.costUsd, at: u.at })),
  };
  historyCache = { at: Date.now(), tzOffsetMs, data };
  return data;
}

module.exports = { readUsageSnapshots, usageHistory };
