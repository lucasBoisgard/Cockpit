const LIMIT_WARN = 80;
const LIMIT_CRIT = 95;
const LIMITS = [['five_hour', '5 h'], ['seven_day', '7 jours'], ['spend_limit', 'Dépenses']];

const level = (pct) => (pct >= LIMIT_CRIT ? 'crit' : pct >= LIMIT_WARN ? 'warn' : '');
const worst = (levels) => (levels.includes('crit') ? 'crit' : levels.includes('warn') ? 'warn' : '');

function limitWindows(limits) {
  if (!limits) return [];
  return LIMITS.filter(([key]) => limits[key]).map(([key, label]) => {
    const w = limits[key];
    const resetsAt = Number.isFinite(w.resets_at) ? w.resets_at * 1000 : null;
    const expired = !!resetsAt && resetsAt < Date.now();
    const pct = expired ? 0 : Math.round(w.used_percentage ?? 0);
    return { key, label, pct, left: Math.max(0, 100 - pct), resetsAt, expired, level: level(pct) };
  });
}

function resetText(w) {
  if (w.expired) return 'Fenêtre réinitialisée depuis le dernier relevé';
  if (!w.resetsAt) return '';
  const mins = Math.max(0, Math.round((w.resetsAt - Date.now()) / 60000));
  const left = mins >= 1440 ? `${Math.floor(mins / 1440)} j ${Math.floor((mins % 1440) / 60)} h` : mins >= 60 ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}` : `${mins} min`;
  const at = new Date(w.resetsAt).toLocaleString('fr-FR', mins >= 1440 ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  return `Réinitialisée dans ${left} (${at})`;
}

function limitTiles(windows) {
  return `<div class="tiles">${windows.map((w) => `
    <div class="tile ${w.level}">
      <span class="tile-label">Limite ${esc(w.label)}</span>
      <span class="tile-value"><b>${w.pct} %</b> utilisés</span>
      <span class="track" role="meter" aria-label="Usage de la limite ${esc(w.label)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${w.pct}"><span class="fill ${w.level}" style="width:${w.pct}%"></span></span>
      <span class="tile-sub">${w.left} % restants</span>
      <span class="tile-sub">${esc(resetText(w))}</span>
    </div>`).join('')}</div>`;
}

const limitAlerts = () => limitWindows(state?.limits).filter((w) => w.level);

function usageCard() {
  const windows = limitWindows(state.limits).filter((w) => w.key !== 'spend_limit' || w.level);
  const alert = worst(windows.map((w) => w.level));
  const meters = windows.map((w) => `<span class="pill-meter ${w.level}" title="${esc(w.label)} : ${w.pct} % utilisés · ${esc(resetText(w))}">${esc(w.label)} <i><em style="width:${w.pct}%"></em></i> ${w.pct} %</span>`).join('');
  const title = `Limites du compte Claude${state.limits ? ` · relevé il y a ${ago(state.limits.at)}` : ''}`;
  return `<button class="tool-pill tokens ${alert} ${selected === USAGE ? 'selected' : ''}" data-usage="1" title="${esc(title)}">
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

function renderUsage() {
  if (selected !== USAGE) return;
  if (!usageData) { $('usage').innerHTML = '<div class="placeholder">Calcul de l’usage…</div>'; return; }
  const windows = limitWindows(usageData.limits);
  const alerts = windows.filter((w) => w.level);
  const total = (t) => t.input + t.cacheWrite + t.cacheRead + t.output;
  const limitsHtml = windows.length
    ? `${alerts.map((w) => `<div class="alert ${w.level}"><b>${w.pct} % utilisés sur la limite ${esc(w.label)}.</b> ${esc(resetText(w))}.${w.level === 'crit' ? ' Les sessions vont bientôt être bloquées.' : ''}</div>`).join('')}
       ${limitTiles(windows)}
       <p class="caption">Relevé il y a ${ago(usageData.limits.at)}, à la dernière réponse de Claude dans une session. Alerte à ${LIMIT_WARN} % utilisés, alerte forte à ${LIMIT_CRIT} %.</p>`
    : '<p class="caption">Pas encore de relevé. Claude Code transmet les limites du compte à la statusline à chaque réponse : elles s’affichent après la prochaine réponse dans une session.</p>';

  const sessions = usageData.sessions.map((s) => {
    const pct = Math.round(s.context?.usedPercentage ?? 0);
    const left = Math.max(0, 100 - pct);
    return `<tr>
      <td class="name">${esc(s.worktree)}</td>
      <td>${esc(s.model || '—')}</td>
      <td class="num"><span class="mini"><span class="${level(pct)}" style="width:${left}%"></span></span>${s.context?.usedPercentage == null ? '—' : `${left} %`}</td>
      <td class="num">${s.context?.size ? fmtTokens(s.context.size) : '—'}</td>
      <td class="num">${fmtUsd(s.costUsd)}</td>
      <td class="num">${ago(s.at)}</td>
    </tr>`;
  }).join('');

  const max = Math.max(1, ...usageData.days.map(total));
  const today = usageData.days[usageData.days.length - 1]?.date;
  const days = usageData.days.map((d) => {
    const t = total(d);
    const label = new Date(`${d.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
    const tip = `${label} · ${fmtTokens(t)} tokens\nEntrée ${fmtTokens(d.input)} · Cache écrit ${fmtTokens(d.cacheWrite)} · Cache lu ${fmtTokens(d.cacheRead)} · Sortie ${fmtTokens(d.output)}`;
    return `<div class="day ${d.date === today ? 'today' : ''}" title="${esc(tip)}">
      <span class="val">${t ? fmtTokens(t) : ''}</span>
      <span class="bar" style="height:${Math.max(1, Math.round((t / max) * 120))}px"></span>
      <span class="lbl">${esc(label)}</span>
    </div>`;
  }).join('');

  const wtMax = Math.max(1, ...usageData.worktrees.map((w) => total(w.week)));
  const worktrees = usageData.worktrees.map((w) => `<tr>
      <td class="name">${esc(w.name)}</td>
      <td class="num">${fmtTokens(total(w.today))}</td>
      <td class="num"><span class="mini"><span style="width:${Math.round((total(w.week) / wtMax) * 100)}%"></span></span>${fmtTokens(total(w.week))}</td>
      <td class="num">${fmtTokens(w.week.output)}</td>
    </tr>`).join('');

  $('usage').innerHTML = `
    <section><h3>Limites du compte</h3>${limitsHtml}</section>
    <section><h3>Sessions</h3>
      ${sessions ? `<div class="table-wrap"><table><thead><tr><th>Worktree</th><th>Modèle</th><th class="num">Contexte restant</th><th class="num">Fenêtre</th><th class="num">Coût estimé</th><th class="num">Relevé</th></tr></thead><tbody>${sessions}</tbody></table></div>` : '<p class="caption">Aucun relevé de session pour l’instant.</p>'}
    </section>
    <section><h3>Tokens traités par jour</h3>
      <div class="days">${days}</div>
      <p class="caption">Entrée, cache écrit, cache lu et sortie, toutes sessions confondues, sous-agents compris. Le cache lu représente l’essentiel du volume mais coûte beaucoup moins qu’une entrée normale. Survole une barre pour le détail.</p>
    </section>
    <section><h3>Par worktree, 7 derniers jours</h3>
      ${worktrees ? `<div class="table-wrap"><table><thead><tr><th>Worktree</th><th class="num">Aujourd’hui</th><th class="num">7 jours</th><th class="num">Sortie (7 j)</th></tr></thead><tbody>${worktrees}</tbody></table></div>` : '<p class="caption">Aucune activité sur la période.</p>'}
    </section>`;
}
