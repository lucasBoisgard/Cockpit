// Claude and GPT should both get their share of the agents a master launches: the choice must rest on relevance and on
// how full each account is, not on habit. Pure decisions: who has had how many agents lately, how full each provider's
// usage windows are, and which one the next agent should go to.
const { highestUsage } = require('./arena-breaker');

const WINDOW_MS = 7 * 86400000;
const DEFAULT_TARGET = 0.5;
// A gap smaller than this is a tie: the provider alternates instead of being pushed.
const TIE = 0.1;
// A provider this full in any window is avoided whatever its share.
const FULL_PERCENT = 90;
const WINDOW_NAMES = { five_hour: '5 h', seven_day: '7 jours' };

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

// launches: [{ provider, createdAt }] of the agents launched, whatever the orchestration (newest last or not: sorted here);
// available: { claude, codex } booleans; target: the GPT share wanted (0.5 = even).
function providerBalance({ launches = [], limits = {}, available = {}, target = DEFAULT_TARGET, now = Date.now(), windowMs = WINDOW_MS } = {}) {
  const recent = launches.filter((l) => Number.isFinite(l.createdAt) && now - l.createdAt <= windowMs).sort((a, b) => a.createdAt - b.createdAt);
  const count = { claude: recent.filter((l) => l.provider !== 'codex').length, codex: recent.filter((l) => l.provider === 'codex').length };
  const total = count.claude + count.codex;
  const last = recent.length ? (recent[recent.length - 1].provider === 'codex' ? 'codex' : 'claude') : null;
  const usage = providerUsage(limits, now);
  const share = (p) => (total ? round(count[p] / total) : 0);
  const side = (p) => ({ agents: count[p], share: share(p), usedPercent: usage[p].worst, weekPercent: usage[p].seven_day });
  const out = { target, windowDays: Math.round(windowMs / 86400000), total, last, claude: side('claude'), codex: side('codex') };
  if (available.claude === false && available.codex === false) return { ...out, prefer: null, reason: 'Aucun fournisseur disponible.' };
  if (available.codex === false) return { ...out, prefer: 'claude', reason: 'GPT indisponible (Codex non connecté).' };
  if (available.claude === false) return { ...out, prefer: 'codex', reason: 'Claude indisponible.' };
  const fullWindow = (p) => Object.keys(WINDOW_NAMES).find((w) => usage[p][w] !== null && usage[p][w] >= FULL_PERCENT) || null;
  const fullC = fullWindow('claude');
  const fullG = fullWindow('codex');
  const name = (p) => (p === 'codex' ? 'GPT' : 'Claude');
  const pct = (p, w) => Math.round(usage[p][w]);
  if (fullG && !fullC) return { ...out, prefer: 'claude', reason: `GPT à ${pct('codex', fullG)} % de sa limite ${WINDOW_NAMES[fullG]}.` };
  if (fullC && !fullG) return { ...out, prefer: 'codex', reason: `Claude à ${pct('claude', fullC)} % de sa limite ${WINDOW_NAMES[fullC]}.` };
  if (fullC && fullG) {
    const prefer = (usage.codex.seven_day ?? usage.codex.worst) <= (usage.claude.seven_day ?? usage.claude.worst) ? 'codex' : 'claude';
    return { ...out, prefer, reason: `Les deux comptes sont presque pleins : ${name(prefer)} a le plus de marge sur 7 jours.` };
  }
  const deficit = total ? target - share('codex') : 0;
  const week = (p) => usage[p].seven_day;
  const headroom = week('claude') !== null && week('codex') !== null ? (week('claude') - week('codex')) / 100 : 0;
  const score = round(deficit + 0.5 * headroom);
  const parts = [];
  if (total) parts.push(`GPT ${Math.round(share('codex') * 100)} % des agents sur ${out.windowDays} j (cible ${Math.round(target * 100)} %)`);
  if (headroom) parts.push(`utilisation 7 jours : Claude ${Math.round(week('claude'))} %, GPT ${Math.round(week('codex'))} %`);
  if (score > TIE) return { ...out, prefer: 'codex', reason: parts.join(' · ') };
  if (score < -TIE) return { ...out, prefer: 'claude', reason: parts.join(' · ') };
  const prefer = last === 'claude' ? 'codex' : 'claude';
  return { ...out, prefer, reason: `Équilibre correct : alterne${last ? ` (le dernier agent était ${name(last)})` : ''}, sauf si l'autre pick est nettement meilleur.` };
}

function balanceText(b) {
  const pct = (p) => (p.usedPercent === null ? '' : ` · limite à ${Math.round(p.usedPercent)} %`);
  const line = `Équilibre Claude/GPT sur ${b.windowDays} j : Claude ${b.claude.agents} agents (${Math.round(b.claude.share * 100)} %)${pct(b.claude)}, GPT ${b.codex.agents} (${Math.round(b.codex.share * 100)} %)${pct(b.codex)}.`;
  return `${line}\n${b.prefer ? `Prochain agent : ${b.prefer === 'codex' ? 'GPT' : 'Claude'}. ${b.reason}` : b.reason}`;
}

module.exports = { providerBalance, providerUsage, choosableAgents, balanceText, DEFAULT_TARGET, TIE, FULL_PERCENT, WINDOW_MS };
