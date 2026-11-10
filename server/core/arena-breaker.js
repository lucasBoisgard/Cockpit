const DEFAULT_LIMIT_PERCENT = 75;

const WINDOW_LABELS = { five_hour: '5 h', seven_day: '7 jours' };
const WINDOW_MS = { five_hour: 5 * 3600000, seven_day: 7 * 86400000 };
const PROVIDER_LABELS = { claude: 'Claude', codex: 'GPT' };

function limitPercent(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 100 ? n : DEFAULT_LIMIT_PERCENT;
}

// The fullest live window among all providers. A window is no longer a reading once its reset time has passed,
// or when the provider's last report is older than the window itself (covers a missing reset time).
function highestUsage(limits, now) {
  let best = null;
  for (const [provider, windows] of Object.entries(limits || {})) {
    const reportedAt = Number.isFinite(windows?.at) ? windows.at : null;
    for (const [window, w] of Object.entries(windows || {})) {
      if (!WINDOW_LABELS[window] || !Number.isFinite(w?.used_percentage)) continue;
      if (Number.isFinite(w.resets_at) && w.resets_at * 1000 < now) continue;
      if (reportedAt !== null && now - reportedAt > WINDOW_MS[window]) continue;
      if (!best || w.used_percentage > best.percent) best = { provider, window, percent: w.used_percentage };
    }
  }
  return best;
}

function arenaBlock(limits, threshold, now) {
  const top = highestUsage(limits, now);
  return top && top.percent >= threshold ? { ...top, threshold } : null;
}

const blockReason = (b) => `utilisation ${PROVIDER_LABELS[b.provider] || b.provider} (${WINDOW_LABELS[b.window]}) à ${Math.round(b.percent)} %, seuil de ${b.threshold} % atteint`;

const refusalText = (b) => `Mode Arène refusé : ${blockReason(b)}. Il reste verrouillé tant que l'utilisation n'est pas redescendue sous ${b.threshold} %.`;

module.exports = { DEFAULT_LIMIT_PERCENT, limitPercent, highestUsage, arenaBlock, blockReason, refusalText };
