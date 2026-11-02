const path = require('node:path');

const emptyTotals = () => ({ input: 0, cacheWrite: 0, cacheRead: 0, output: 0 });

function addTotals(into, from) {
  for (const key of Object.keys(into)) into[key] += from[key];
}

const totalOf = (t) => t.input + t.cacheWrite + t.cacheRead + t.output;

function usageWorktree(cwd, repo) {
  const match = String(cwd || '').match(/\.claude\/worktrees\/([^/]+)/);
  if (match) return match[1];
  if (cwd === repo || String(cwd || '').startsWith(`${repo}/`)) return 'main';
  return cwd ? path.basename(cwd) : '?';
}

function latestLimits(snapshots) {
  const latest = snapshots.filter((u) => u.rateLimits).sort((a, b) => b.at - a.at)[0];
  return latest ? { ...latest.rateLimits, at: latest.at } : null;
}

const tzOffsetMsOf = (tzOffsetMin) => (Number.isFinite(tzOffsetMin) ? Math.max(-840, Math.min(840, tzOffsetMin)) : 0) * 60000;

function dayKeys(now, tzOffsetMs, count) {
  return Array.from({ length: count }, (_, i) => new Date(now - tzOffsetMs - (count - 1 - i) * 86400000).toISOString().slice(0, 10));
}

function newUsageEntry(tzOffsetMs) {
  return { offset: 0, tzOffsetMs, cwd: null, seen: new Set(), days: new Map() };
}

function addUsageLines(entry, text) {
  for (const line of text.split('\n')) {
    if (entry.cwd && !line.includes('"usage"')) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    entry.cwd = entry.cwd || row.cwd || null;
    const usage = row.message?.usage;
    if (row.type !== 'assistant' || !usage || !row.timestamp) continue;
    const id = row.message.id || row.requestId;
    if (id && entry.seen.has(id)) continue;
    if (id) entry.seen.add(id);
    const day = new Date(Date.parse(row.timestamp) - entry.tzOffsetMs).toISOString().slice(0, 10);
    if (!entry.days.has(day)) entry.days.set(day, emptyTotals());
    addTotals(entry.days.get(day), {
      input: usage.input_tokens || 0,
      cacheWrite: usage.cache_creation_input_tokens || 0,
      cacheRead: usage.cache_read_input_tokens || 0,
      output: usage.output_tokens || 0,
    });
  }
  return entry;
}

function aggregateUsage(entries, keys, repo) {
  const today = keys[keys.length - 1];
  const days = new Map(keys.map((d) => [d, emptyTotals()]));
  const worktrees = new Map();
  for (const entry of entries) {
    const name = usageWorktree(entry.cwd, repo);
    for (const [day, totals] of entry.days) {
      if (!days.has(day)) continue;
      addTotals(days.get(day), totals);
      if (!worktrees.has(name)) worktrees.set(name, { name, week: emptyTotals(), today: emptyTotals() });
      addTotals(worktrees.get(name).week, totals);
      if (day === today) addTotals(worktrees.get(name).today, totals);
    }
  }
  return {
    days: [...days].map(([date, totals]) => ({ date, ...totals })),
    worktrees: [...worktrees.values()].sort((a, b) => totalOf(b.week) - totalOf(a.week)),
  };
}

module.exports = { emptyTotals, addTotals, totalOf, usageWorktree, latestLimits, tzOffsetMsOf, dayKeys, newUsageEntry, addUsageLines, aggregateUsage };
