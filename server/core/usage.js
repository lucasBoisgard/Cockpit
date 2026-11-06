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

// Codex rollouts report cumulative totals in "token_count" events; OpenAI counts cached tokens inside
// input_tokens, so the fresh input is input − cached. Each delta goes to the day of its event.
const CODEX_WINDOWS = { 300: 'five_hour', 10080: 'seven_day' };

function codexLimits(rateLimits) {
  const out = {};
  for (const [slot, fallback] of [['primary', 'five_hour'], ['secondary', 'seven_day']]) {
    const w = rateLimits?.[slot];
    if (w && Number.isFinite(w.used_percent)) out[CODEX_WINDOWS[w.window_minutes] || fallback] = { used_percentage: w.used_percent, resets_at: w.resets_at };
  }
  return Object.keys(out).length ? out : null;
}

const codexModelLabel = (id) => String(id || '').replace(/^gpt-/i, 'GPT-').replace(/-([a-z])([a-z]*)$/, (_, a, b) => ` ${a.toUpperCase()}${b}`) || null;

function newCodexEntry(tzOffsetMs) {
  return { ...newUsageEntry(tzOffsetMs), provider: 'codex', sessionId: null, model: null, last: null, context: null, rateLimits: null, at: null };
}

function addCodexLines(entry, text) {
  for (const line of text.split('\n')) {
    if (entry.cwd && !line.includes('"token_count"') && !line.includes('"turn_context"')) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const p = row.payload || {};
    if (row.type === 'session_meta') { entry.cwd = entry.cwd || p.cwd || null; entry.sessionId = entry.sessionId || p.id || p.session_id || null; continue; }
    if (row.type === 'turn_context') { entry.model = p.model || entry.model; entry.cwd = entry.cwd || p.cwd || null; continue; }
    if (row.type !== 'event_msg' || p.type !== 'token_count' || !row.timestamp) continue;
    const at = Date.parse(row.timestamp);
    if (p.rate_limits) { const limits = codexLimits(p.rate_limits); if (limits) entry.rateLimits = { ...limits, at }; }
    const total = p.info?.total_token_usage;
    if (!total) continue;
    entry.at = at;
    const window = p.info.model_context_window;
    const used = p.info.last_token_usage?.input_tokens;
    if (window && Number.isFinite(used)) entry.context = { size: window, usedPercentage: Math.min(100, (used / window) * 100) };
    const prev = entry.last || { input_tokens: 0, cached_input_tokens: 0, cache_write_input_tokens: 0, output_tokens: 0 };
    const delta = (k) => Math.max(0, (total[k] || 0) - (prev[k] || 0));
    entry.last = total;
    const day = new Date(at - entry.tzOffsetMs).toISOString().slice(0, 10);
    if (!entry.days.has(day)) entry.days.set(day, emptyTotals());
    const cached = delta('cached_input_tokens');
    addTotals(entry.days.get(day), { input: Math.max(0, delta('input_tokens') - cached), cacheWrite: delta('cache_write_input_tokens'), cacheRead: cached, output: delta('output_tokens') });
  }
  return entry;
}

const PROVIDER_KEYS = ['claude', 'codex'];
const emptyByProvider = () => ({ claude: emptyTotals(), codex: emptyTotals() });

// Days and worktrees split by provider ({ claude, codex } totals each).
function aggregateUsage(entries, keys, repo) {
  const today = keys[keys.length - 1];
  const days = new Map(keys.map((d) => [d, emptyByProvider()]));
  const worktrees = new Map();
  for (const entry of entries) {
    const name = usageWorktree(entry.cwd, repo);
    const provider = entry.provider === 'codex' ? 'codex' : 'claude';
    for (const [day, totals] of entry.days) {
      if (!days.has(day)) continue;
      addTotals(days.get(day)[provider], totals);
      if (!worktrees.has(name)) worktrees.set(name, { name, week: emptyByProvider(), today: emptyByProvider() });
      addTotals(worktrees.get(name).week[provider], totals);
      if (day === today) addTotals(worktrees.get(name).today[provider], totals);
    }
  }
  const sum = (byProvider) => PROVIDER_KEYS.reduce((n, k) => n + totalOf(byProvider[k]), 0);
  return {
    days: [...days].map(([date, byProvider]) => ({ date, ...byProvider })),
    worktrees: [...worktrees.values()].sort((a, b) => sum(b.week) - sum(a.week)),
  };
}

module.exports = { emptyTotals, addTotals, totalOf, usageWorktree, latestLimits, tzOffsetMsOf, dayKeys, newUsageEntry, addUsageLines, codexLimits, codexModelLabel, newCodexEntry, addCodexLines, aggregateUsage };
