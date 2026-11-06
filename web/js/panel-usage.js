// Tokens: account limits, sessions and daily use for both providers. Claude in violet, GPT in teal.
const LIMIT_WARN = 80;
const LIMIT_CRIT = 95;
const LIMITS = [['five_hour', '5 h'], ['seven_day', '7 jours'], ['spend_limit', 'Dépenses']];
const USAGE_PROVIDERS = [['claude', 'Claude'], ['codex', 'GPT']];
const USAGE_SESSIONS_SHOWN = 8;

const usageMoreButton = (key, count) => (count > USAGE_SESSIONS_SHOWN
  ? `<button class="us-more" data-usage-more="${key}">${usageMore[key] ? 'Réduire' : `Afficher les ${count - USAGE_SESSIONS_SHOWN} autres`}</button>` : '');
const usageMore = { sessions: false, worktrees: false };

const level = (pct) => (pct >= LIMIT_CRIT ? 'crit' : pct >= LIMIT_WARN ? 'warn' : '');
const worst = (levels) => (levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : '');
const usageTotal = (t) => (t ? t.input + t.cacheWrite + t.cacheRead + t.output : 0);
const usageSum = (byProvider) => USAGE_PROVIDERS.reduce((n, [id]) => n + usageTotal(byProvider?.[id]), 0);
const usageDot = (id) => `<span class="us-dot us-${id}"></span>`;

function limitWindows(limits, provider = 'Claude') {
  if (!limits) return [];
  return LIMITS.filter(([key]) => limits[key]).map(([key, label]) => {
    const w = limits[key];
    const resetsAt = Number.isFinite(w.resets_at) ? w.resets_at * 1000 : null;
    const expired = !!resetsAt && resetsAt < Date.now();
    const pct = expired ? 0 : Math.round(w.used_percentage ?? 0);
    return { key, label: `${provider} ${label}`, short: label, pct, left: Math.max(0, 100 - pct), resetsAt, expired, level: level(pct) };
  });
}

// The providers that reported limits, each with its windows and the time of the reading.
function providerLimits(limits) {
  return USAGE_PROVIDERS.map(([id, name]) => ({ id, name, at: limits?.[id]?.at, windows: limitWindows(limits?.[id], name) })).filter((p) => p.windows.length);
}

function resetText(w) {
  if (w.expired) return 'Fenêtre réinitialisée depuis le dernier relevé';
  if (!w.resetsAt) return '';
  const mins = Math.max(0, Math.round((w.resetsAt - Date.now()) / 60000));
  const left = mins >= 1440 ? `${Math.floor(mins / 1440)} j ${Math.floor((mins % 1440) / 60)} h` : mins >= 60 ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}` : `${mins} min`;
  const at = new Date(w.resetsAt).toLocaleString('fr-FR', mins >= 1440 ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  return `Réinitialisée dans ${left} (${at})`;
}

const limitAlerts = () => providerLimits(state?.limits).flatMap((p) => p.windows).filter((w) => w.level);

// Top pill: one meter per provider, at its most used window; the detail is in the tooltip.
function usageCard() {
  const providers = providerLimits(state.limits);
  const meters = providers.map((p) => {
    const windows = p.windows.filter((w) => w.key !== 'spend_limit' || w.level);
    const top = windows.reduce((a, b) => (b.pct > a.pct ? b : a), windows[0]);
    const tip = `${p.name} · ${windows.map((w) => `${w.short} : ${w.pct} %`).join(' · ')}${p.at ? ` · relevé il y a ${ago(p.at)}` : ''}`;
    return `<span class="pill-meter us-meter ${top.level}" title="${esc(tip)}">${usageDot(p.id)}${esc(p.name)} <i><em class="us-fill-${p.id}" style="width:${top.pct}%"></em></i> ${top.pct} %</span>`;
  }).join('');
  const alert = worst(providers.flatMap((p) => p.windows.map((w) => w.level)));
  return `<button class="tool-pill tokens ${alert} ${selected === USAGE ? 'selected' : ''}" data-usage="1" title="Limites des comptes Claude et GPT">
    <b>Tokens</b>${meters || '<span class="pill-sub">en attente du premier relevé</span>'}
  </button>`;
}

async function loadUsage() {
  try {
    const res = await api(`/api/usage?tz=${new Date().getTimezoneOffset()}`);
    if (!res.ok) return;
    usageData = await res.json();
  } catch {
    return;
  }
  renderUsage();
}

function usageLimitsHtml(providers) {
  if (!providers.length) return '<p class="caption">Pas encore de relevé : les limites s’affichent après la prochaine réponse dans une session.</p>';
  const alerts = providers.flatMap((p) => p.windows).filter((w) => w.level);
  return `${alerts.map((w) => `<div class="alert ${w.level}"><b>${w.pct} % utilisés sur la limite ${esc(w.label)}.</b> ${esc(resetText(w))}.</div>`).join('')}
    <div class="us-providers">${providers.map((p) => `
      <div class="us-provider">
        <div class="us-provider-head">${usageDot(p.id)}<b>${esc(p.name)}</b>${p.at ? `<span>relevé il y a ${ago(p.at)}</span>` : ''}</div>
        <div class="us-windows">${p.windows.map((w) => `
          <div class="us-window ${w.level}">
            <span class="us-window-label">${esc(w.short)}</span>
            <span class="us-window-value"><b>${w.pct} %</b> utilisés</span>
            <span class="track" role="meter" aria-label="Limite ${esc(w.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${w.pct}"><span class="fill us-fill-${p.id} ${w.level}" style="width:${w.pct}%"></span></span>
            <span class="tile-sub">${esc(resetText(w)) || `${w.left} % restants`}</span>
          </div>`).join('')}</div>
      </div>`).join('')}</div>`;
}

function usageSessionsHtml(list) {
  if (!list.length) return '<p class="caption">Aucun relevé de session pour l’instant.</p>';
  const shown = usageMore.sessions ? list : list.slice(0, USAGE_SESSIONS_SHOWN);
  const rows = shown.map((s) => {
    const pct = Math.round(s.context?.usedPercentage ?? 0);
    const left = Math.max(0, 100 - pct);
    const provider = s.provider === 'codex' ? 'codex' : 'claude';
    return `<tr>
      <td class="name">${esc(s.worktree)}</td>
      <td>${usageDot(provider)}${esc(s.model || (provider === 'codex' ? 'GPT' : '—'))}</td>
      <td class="num"><span class="mini"><span class="${level(pct)}" style="width:${left}%"></span></span>${s.context?.usedPercentage == null ? '—' : `${left} %`}</td>
      <td class="num">${s.context?.size ? fmtTokens(s.context.size) : '—'}</td>
      <td class="num">${s.costUsd == null ? '—' : fmtUsd(s.costUsd)}</td>
      <td class="num">${ago(s.at)}</td>
    </tr>`;
  }).join('');
  const more = usageMoreButton('sessions', list.length);
  return `<div class="table-wrap"><table><thead><tr><th>Worktree</th><th>Modèle</th><th class="num">Contexte restant</th><th class="num">Fenêtre</th><th class="num">Coût estimé</th><th class="num">Relevé</th></tr></thead><tbody>${rows}</tbody></table></div>${more}`;
}

// A bar stacked by provider, Claude at the base; each segment is a fraction of `max`.
function usageStack(byProvider, max, vertical) {
  const segs = USAGE_PROVIDERS.map(([id]) => [id, usageTotal(byProvider?.[id])]).filter(([, n]) => n);
  return segs.map(([id, n]) => `<span class="us-seg us-fill-${id}" style="${vertical ? 'height' : 'width'}:${Math.max(vertical ? 2 : 1, Math.round((n / max) * (vertical ? 120 : 60)))}px"></span>`).join('');
}

const usageSplit = (byProvider) => USAGE_PROVIDERS.filter(([id]) => usageTotal(byProvider?.[id])).map(([id, name]) => `${name} ${fmtTokens(usageTotal(byProvider[id]))}`).join(' · ');

function renderUsage() {
  if (selected !== USAGE) return;
  if (!usageData) { $('usage').innerHTML = '<div class="placeholder">Calcul de l’usage…</div>'; return; }
  const providers = providerLimits(usageData.limits);
  const hasGpt = usageData.days.some((d) => usageTotal(d.codex)) || providers.some((p) => p.id === 'codex');
  const legend = hasGpt ? `<span class="us-legend">${USAGE_PROVIDERS.map(([id, name]) => `<span>${usageDot(id)}${name}</span>`).join('')}</span>` : '';

  const max = Math.max(1, ...usageData.days.map(usageSum));
  const today = usageData.days[usageData.days.length - 1]?.date;
  const days = usageData.days.map((d) => {
    const t = usageSum(d);
    const label = new Date(`${d.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
    const tip = `${label} · ${fmtTokens(t)} tokens${t ? `\n${usageSplit(d)}` : ''}`;
    return `<div class="day ${d.date === today ? 'today' : ''}" title="${esc(tip)}">
      <span class="val">${t ? fmtTokens(t) : ''}</span>
      <span class="us-col">${usageStack(d, max, true)}</span>
      <span class="lbl">${esc(label)}</span>
    </div>`;
  }).join('');

  const wtMax = Math.max(1, ...usageData.worktrees.map((w) => usageSum(w.week)));
  const output = (byProvider) => USAGE_PROVIDERS.reduce((n, [id]) => n + (byProvider?.[id]?.output || 0), 0);
  const tokensOrDash = (n) => (n ? fmtTokens(n) : '—');
  const wtList = usageMore.worktrees ? usageData.worktrees : usageData.worktrees.slice(0, USAGE_SESSIONS_SHOWN);
  const worktrees = wtList.map((w) => `<tr>
      <td class="name">${esc(w.name)}</td>
      <td class="num">${tokensOrDash(usageSum(w.today))}</td>
      <td class="num" title="${esc(usageSplit(w.week))}"><span class="us-row">${usageStack(w.week, wtMax, false)}</span><span class="us-num">${fmtTokens(usageSum(w.week))}</span></td>
      <td class="num">${fmtTokens(output(w.week))}</td>
    </tr>`).join('');

  $('usage').innerHTML = `
    <section><h3>Limites des comptes</h3>${usageLimitsHtml(providers)}</section>
    <section><h3>Sessions</h3>${usageSessionsHtml(usageData.sessions)}</section>
    <section><div class="us-head"><h3>Tokens par jour</h3>${legend}</div>
      <div class="days">${days}</div>
      <p class="caption">Entrée, cache et sortie, sous-agents compris. Survole une barre pour le détail.</p>
    </section>
    <section><h3>Par worktree, 7 jours</h3>
      ${worktrees ? `<div class="table-wrap"><table><thead><tr><th>Worktree</th><th class="num">Aujourd’hui</th><th class="num">7 jours</th><th class="num">Sortie</th></tr></thead><tbody>${worktrees}</tbody></table></div>${usageMoreButton('worktrees', usageData.worktrees.length)}` : '<p class="caption">Aucune activité sur la période.</p>'}
    </section>`;
}

$('usage').addEventListener('click', (e) => {
  const more = e.target.closest('[data-usage-more]');
  if (!more) return;
  usageMore[more.dataset.usageMore] = !usageMore[more.dataset.usageMore];
  renderUsage();
});
