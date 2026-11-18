// Claude and GPT accounts differ in size: the choice rests on how full each provider's usage windows are and how fast each
// burns its quota per unit of work, never on an even split of agents. Pure decisions.
const { highestUsage } = require('./arena-breaker');

const WINDOW_MS = 7 * 86400000;
// A fill gap smaller than this many points is a tie; a burn rate must exceed the other by this ratio to count as faster.
const TIE_POINTS = 3;
const BURN_RATIO = 1.25;
// A provider this full in any window is avoided whatever its share.
const FULL_PERCENT = 90;
const WINDOW_NAMES = { five_hour: '5 h', seven_day: '7 j' };

const round = (n) => Math.round(n * 1000) / 1000;

// The reading of each live window of each provider, and the fullest one.
function providerUsage(limits, now) {
  const windowOf = (provider, window) => {
    const source = limits?.[provider];
    return highestUsage({ [provider]: { at: source?.at, [window]: source?.[window] } }, now)?.percent ?? null;
  };
  const of = (provider) => {
    const five = windowOf(provider, 'five_hour');
    const seven = windowOf(provider, 'seven_day');
    const known = [five, seven].filter((n) => n !== null);
    return { five_hour: five, seven_day: seven, worst: known.length ? Math.max(...known) : null };
  };
  return { claude: of('claude'), codex: of('codex') };
}

// The agents whose provider was a real choice: an agent that launched agents of its own is a Claude orchestrator by necessity.
function choosableAgents(store) {
  const rows = [];
  for (const orch of Object.values(store || {})) {
    const agents = orch.agents || [];
    const parents = new Set(agents.map((a) => a.parentId).filter(Boolean));
    for (const a of agents) if (!parents.has(a.id)) rows.push({ provider: a.provider || 'claude', createdAt: a.createdAt });
  }
  return rows;
}

// Both providers should fill their usage windows evenly, weekly window first, the 5 h window as a guard. The account that is
// the less full gets the next agent, unless it burns its quota faster per unit of work: that one is never pushed.
// launches: [{ provider, createdAt }] of the agents launched; work: { claude, codex } units of work done over the same
// 7 days (tokens); available: { claude, codex } booleans.
function providerBalance({ launches = [], limits = {}, available = {}, work = {}, now = Date.now(), windowMs = WINDOW_MS } = {}) {
  const recent = launches.filter((l) => Number.isFinite(l.createdAt) && now - l.createdAt <= windowMs).sort((a, b) => a.createdAt - b.createdAt);
  const count = { claude: recent.filter((l) => l.provider !== 'codex').length, codex: recent.filter((l) => l.provider === 'codex').length };
  const total = count.claude + count.codex;
  const last = recent.length ? (recent[recent.length - 1].provider === 'codex' ? 'codex' : 'claude') : null;
  const usage = providerUsage(limits, now);
  const share = (p) => (total ? round(count[p] / total) : 0);
  const useTokens = work.claude > 0 && work.codex > 0;
  const burn = (p) => {
    const units = useTokens ? work[p] : count[p] > 0 && count.claude > 0 && count.codex > 0 ? count[p] : null;
    return usage[p].seven_day !== null && units ? usage[p].seven_day / units : null;
  };
  const side = (p) => ({ agents: count[p], share: share(p), usedPercent: usage[p].worst, weekPercent: usage[p].seven_day, shortPercent: usage[p].five_hour, burn: burn(p) });
  const out = { windowDays: Math.round(windowMs / 86400000), total, last, claude: side('claude'), codex: side('codex') };
  if (available.claude === false && available.codex === false) return { ...out, prefer: null, reason: 'Aucun fournisseur disponible.' };
  if (available.codex === false) return { ...out, prefer: 'claude', reason: 'GPT indisponible (Codex non connecté).' };
  if (available.claude === false) return { ...out, prefer: 'codex', reason: 'Claude indisponible.' };
  const name = (p) => (p === 'codex' ? 'GPT' : 'Claude');
  const other = (p) => (p === 'codex' ? 'claude' : 'codex');
  const pct = (p, w) => Math.round(usage[p][w]);
  const fullWindow = (p) => Object.keys(WINDOW_NAMES).find((w) => usage[p][w] !== null && usage[p][w] >= FULL_PERCENT) || null;
  const fullC = fullWindow('claude');
  const fullG = fullWindow('codex');
  if (fullG && !fullC) return { ...out, prefer: 'claude', reason: `GPT à ${pct('codex', fullG)} % de sa limite ${WINDOW_NAMES[fullG]}.` };
  if (fullC && !fullG) return { ...out, prefer: 'codex', reason: `Claude à ${pct('claude', fullC)} % de sa limite ${WINDOW_NAMES[fullC]}.` };
  const lessFull = (w) => {
    const c = usage.claude[w];
    const g = usage.codex[w];
    if (c === null || g === null || Math.abs(c - g) < TIE_POINTS) return null;
    return g < c ? 'codex' : 'claude';
  };
  const windowLine = (w) => `${WINDOW_NAMES[w]} : Claude ${pct('claude', w)} %, GPT ${pct('codex', w)} %`;
  const unknown = ['seven_day', 'five_hour'].filter((w) => usage.claude[w] === null || usage.codex[w] === null);
  const week = unknown.includes('seven_day') ? null : lessFull('seven_day');
  const fast = burn('claude') !== null && burn('codex') !== null && burn('claude') > 0 && burn('codex') > 0
    ? (burn('codex') > burn('claude') * BURN_RATIO ? 'codex' : burn('claude') > burn('codex') * BURN_RATIO ? 'claude' : null)
    : null;
  const note = unknown.includes('seven_day') ? ' Fenêtre 7 jours inconnue pour un des comptes.' : '';
  if (week) {
    if (fast === week) {
      return { ...out, prefer: other(week), reason: `${name(week)} est moins plein (${windowLine('seven_day')}) mais se vide plus vite par tâche : ${name(other(week))} privilégié.` };
    }
    return { ...out, prefer: week, reason: `${name(week)} est le moins plein (${windowLine('seven_day')}).` };
  }
  if (!unknown.includes('seven_day') && fast) {
    return { ...out, prefer: other(fast), reason: `Remplissage 7 jours équivalent (${windowLine('seven_day')}) : ${name(fast)} se vide plus vite par tâche.` };
  }
  const short = unknown.includes('five_hour') ? null : lessFull('five_hour');
  if (short) return { ...out, prefer: short, reason: `${name(short)} a le plus de marge sur la fenêtre courte (${windowLine('five_hour')}).${note}` };
  const prefer = last === 'claude' ? 'codex' : 'claude';
  const known = unknown.length < 2;
  return { ...out, prefer, reason: `${known ? 'Remplissage équivalent' : 'Fenêtres de limite inconnues'} : alterne${last ? ` (le dernier agent était ${name(last)})` : ''}.${note}` };
}

function balanceText(b) {
  const w = (p) => (p.weekPercent === null ? '7 j inconnu' : `7 j ${Math.round(p.weekPercent)} %`);
  const s = (p) => (p.shortPercent === null ? '5 h inconnu' : `5 h ${Math.round(p.shortPercent)} %`);
  const line = `Remplissage des limites : Claude ${w(b.claude)}, ${s(b.claude)} (${b.claude.agents} agents sur ${b.windowDays} j) · GPT ${w(b.codex)}, ${s(b.codex)} (${b.codex.agents} agents).`;
  return `${line}\n${b.prefer ? `Prochain agent : ${b.prefer === 'codex' ? 'GPT' : 'Claude'}. ${b.reason}` : b.reason}`;
}

module.exports = { providerBalance, providerUsage, choosableAgents, balanceText, TIE_POINTS, BURN_RATIO, FULL_PERCENT, WINDOW_MS };
