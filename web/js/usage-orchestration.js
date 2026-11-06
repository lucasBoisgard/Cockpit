// Tokens of an orchestrated session grouped in one expandable block: master, agents and sub-agents, every job.
const uoOpen = new Set(parseJson(localGet('usageOrchOpen'), []));
const uoTotal = (t) => (t ? t.input + t.cacheWrite + t.cacheRead + t.output : 0);

function uoDuration(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 1) return '< 1 min';
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${String(mins % 60).padStart(2, '0')}` : `${mins} min`;
}

const uoModelLabel = (m) => [m.model || 'modèle par défaut', m.effort].filter(Boolean).join(' · ');

function uoShareBar(models, total) {
  if (!total) return '';
  const segs = models.map((m, i) => `<span class="uo-seg us-fill-${m.provider}" style="width:${(m.tokens / total) * 100}%;opacity:${Math.max(0.45, 1 - i * 0.18)}" title="${esc(`${uoModelLabel(m)} : ${fmtTokens(m.tokens)} (${Math.round((m.tokens / total) * 100)} %)`)}"></span>`).join('');
  return `<span class="uo-bar" role="img" aria-label="Part des tokens par modèle">${segs}</span>`;
}

function uoHeader(g) {
  const open = uoOpen.has(g.masterSessionId);
  const cache = g.totals.cacheRead + g.totals.cacheWrite;
  const split = USAGE_PROVIDERS.filter(([id]) => g.byProvider[id]).map(([id, name]) => `<span>${usageDot(id)}${name} <b>${fmtTokens(g.byProvider[id])}</b></span>`).join('');
  const top = g.models.slice(0, 3).map((m) => `${esc(uoModelLabel(m))} ${Math.round((m.tokens / g.tokens) * 100)} %`).join(' · ');
  const title = g.worktree || g.masterSessionId.slice(0, 8);
  return `<button class="uo-head" data-uo="${esc(g.masterSessionId)}" aria-expanded="${open}" title="${esc(g.goal)}">
    <span class="uo-chev">${open ? '▾' : '▸'}</span>
    <span class="uo-main">
      <span class="uo-line"><b class="uo-title">${esc(title)}</b>${g.active ? '<span class="chip">en cours</span>' : ''}<span class="uo-goal">${esc(g.goal)}</span></span>
      <span class="uo-line uo-stats">
        <span class="uo-big" title="${esc(g.partial && g.hasUsage ? 'Total partiel : certaines sessions n’ont pas de relevé' : '')}">${g.hasUsage ? `${g.partial ? '≥ ' : ''}${fmtTokens(g.tokens)}` : '—'} <small>tokens</small></span>
        ${g.hasUsage ? `<span>Entrée <b>${fmtTokens(g.totals.input)}</b></span><span>Sortie <b>${fmtTokens(g.totals.output)}</b></span><span>Cache <b>${fmtTokens(cache)}</b></span>` : '<span>Aucun relevé de tokens</span>'}
        ${g.costUsd == null ? '' : `<span>Coût estimé <b>${g.costMissing ? `≥ ${fmtUsd(g.costUsd)}` : fmtUsd(g.costUsd)}</b>${g.costMissing ? ` <small>(${g.costMissing} session${g.costMissing > 1 ? 's' : ''} sans coût)</small>` : ''}</span>`}
        ${split}
        <span><b>${g.agentCount}</b> agent${g.agentCount > 1 ? 's' : ''}${g.jobs.length > 1 ? ` · ${g.jobs.length} jobs` : ''}</span>
        <span>${uoDuration(g.wallMs)}</span>
      </span>
      <span class="uo-line">${uoShareBar(g.models, g.tokens)}<span class="uo-top">${top}</span></span>
    </span>
  </button>`;
}

function uoRowHtml(r, total) {
  const n = uoTotal(r.totals);
  const share = total ? (n / total) * 100 : 0;
  const label = r.role === 'master' ? 'Maître' : `${esc(r.id)} · ${esc(r.name)}`;
  return `<tr class="${r.role === 'master' ? 'uo-master' : ''}">
    <td class="name" style="padding-left:${8 + r.depth * 16}px">${usageDot(r.provider)}${label}</td>
    <td>${esc(uoModelLabel(r))}</td>
    <td>${esc(r.kind || '—')}</td>
    <td class="num" title="${r.totals ? esc(`Entrée ${fmtTokens(r.totals.input)} · Sortie ${fmtTokens(r.totals.output)} · Cache ${fmtTokens(r.totals.cacheRead + r.totals.cacheWrite)}`) : 'Pas de relevé pour cette session'}"><span class="mini"><span style="width:${share}%"></span></span>${r.totals ? fmtTokens(n) : '—'}</td>
    <td class="num">${r.rating == null ? '—' : `${r.rating}/5`}</td>
  </tr>`;
}

function uoRowsHtml(g) {
  const multi = g.jobs.length > 1;
  let lastJob;
  const body = g.rows.map((r) => {
    let head = '';
    if (multi && r.job != null && r.job !== lastJob) {
      const j = g.jobs.find((x) => x.job === r.job);
      head = `<tr class="uo-job"><td colspan="5">Job ${r.job}${j?.goal ? ` · ${esc(j.goal.slice(0, 120))}` : ''}${j?.endedAt ? ' · archivé' : ''}</td></tr>`;
    }
    if (r.job != null) lastJob = r.job;
    return head + uoRowHtml(r, g.tokens);
  }).join('');
  const missing = g.withoutUsage ? `<p class="caption">${g.withoutUsage} session${g.withoutUsage > 1 ? 's' : ''} sans relevé de tokens (hors des 7 derniers jours ou pas encore démarrée).</p>` : '';
  return `<div class="table-wrap"><table><thead><tr><th>Agent</th><th>Modèle · effort</th><th>Type</th><th class="num">Tokens</th><th class="num">Note</th></tr></thead><tbody>${body}</tbody></table></div>${missing}`;
}

function usageOrchestrationsHtml(groups) {
  if (!groups?.length) return '';
  const blocks = groups.map((g) => `<div class="uo-group ${uoOpen.has(g.masterSessionId) ? 'open' : ''}">${uoHeader(g)}${uoOpen.has(g.masterSessionId) ? `<div class="uo-body">${uoRowsHtml(g)}</div>` : ''}</div>`).join('');
  return `<section><h3>Sessions orchestrées</h3>${blocks}</section>`;
}

$('usage').addEventListener('click', (e) => {
  const head = e.target.closest('[data-uo]');
  if (!head) return;
  const id = head.dataset.uo;
  if (!uoOpen.delete(id)) uoOpen.add(id);
  localSet('usageOrchOpen', JSON.stringify([...uoOpen]));
  renderUsage();
});
