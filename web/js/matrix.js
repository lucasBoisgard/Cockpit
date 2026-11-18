// Relevance matrix page: which provider, model and effort fits which kind of task, the evidence behind each pick's
// score out of 100, and local edits on top of the versioned default.
const matrixUi = { data: null, providers: null, balance: null, pick: null, edit: null, busy: false };
const MX_EFFORT = { low: 'Bas', medium: 'Moyen', high: 'Élevé', xhigh: 'Très élevé', max: 'Max', ultra: 'Ultra' };

async function loadMatrix() {
  const [m, p, b] = await Promise.all([api('/api/matrix').then((r) => (r.ok ? r.json() : null)).catch(() => null), api('/api/providers').then((r) => (r.ok ? r.json() : null)).catch(() => null), api('/api/balance').then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
  if (!m) { toast('Lecture de la matrice impossible.', 'error'); return; }
  matrixUi.data = m;
  matrixUi.providers = p;
  matrixUi.balance = b;
  if (!matrixUi.pick || !m.categories.some((c) => c.id === matrixUi.pick)) matrixUi.pick = m.categories[0]?.id || null;
  renderMatrix();
}

function openMatrix() {
  openPage($('matrix-dialog'));
  renderMatrix();
  loadMatrix();
}

const mxProvider = (p) => (p === 'codex' ? '<span class="mx-gpt">GPT</span>' : '<span class="mx-claude">Claude</span>');
const mxDots = (n, max = 5) => `<span class="mx-dots" title="${n}/${max}">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
const mxLevel = (n) => (n == null ? '—' : ['', 'bas', 'moyen', 'élevé', 'très élevé'][n] || n);

const MX_ROLE = { reviewer: 'relecteur', challenger: 'challenger', judge: 'juge Arène', consumer: 'consommateur', author: 'auteur' };
const MX_OUTCOME = { 'as-is': 'tels quels', fixed: 'après corrections', partial: 'partiels', redone: 'refaits' };
const MX_CONF = { 'à éprouver': 0, faible: 1, moyenne: 2, solide: 3 };
const mxLabel = (p) => `${p.provider === 'codex' ? 'GPT ' : ''}${p.model} · ${MX_EFFORT[p.effort] || p.effort || 'défaut'}`;
const mxTokens = (n) => (Math.round(n / 1e3) < 1000 ? `${Math.round(n / 1e3)} k` : `${(Math.round(n / 1e5) / 10).toLocaleString('fr-FR')} M`);
const mxDuration = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);
const mxPlural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function mxVerdictLine(o) {
  if (o.kind === 'reviewer') return `${o.agent || '?'} · ${o.score}/100 · relecteur : ${o.C} confirmé${o.C > 1 ? 's' : ''}, ${o.F} faux, ${o.M} manqué${o.M > 1 ? 's' : ''}`;
  const judges = o.judges.map((j) => `${j.agent || '?'} ${MX_ROLE[j.role] || j.role} ${mxLabel(j)}`).join(' ; ') || 'sans juge';
  return `${o.agent || '?'} · ${o.score}/100 · jugé par ${judges} : ${mxPlural(o.counted, 'constat')} retenu${o.counted > 1 ? 's' : ''}${o.contested ? `, ${o.contested} contesté${o.contested > 1 ? 's' : ''}` : ''}`;
}

function mxScoreCell(p) {
  const level = MX_CONF[p.confidence] ?? 0;
  const tone = p.goodEnough ? 'ok' : 'low';
  return `<div class="mx-score ${tone}" title="${p.goodEnough ? 'Assez bon : au moins 70/100' : 'Sous le seuil de 70/100'}"><b>${p.quality}</b><small>/100</small></div><div class="mx-bar"><i style="width:${Math.max(0, Math.min(100, p.quality))}%"></i></div><span class="mx-conf mx-conf-${level}">${esc(p.confidence)}</span>`;
}

function mxEvidenceCell(p) {
  const ev = p.evidence || {};
  const lastThree = (ev.observations || []).filter((o) => o.level !== 'outcome' && o.level !== 'legacy').slice(-3).reverse();
  const tip = lastThree.length ? lastThree.map(mxVerdictLine).join('\n') : 'Aucun verdict vérifié pour l’instant.';
  const legacy = ev.legacyCount || 0;
  const verified = ev.verified || 0;
  const unverified = Math.max(0, (ev.observationCount || 0) - verified - legacy);
  return `<span class="mx-evidence" tabindex="0" title="${esc(tip)}"><b>${verified}</b> vérifié${verified > 1 ? 's' : ''}</span>${unverified || legacy ? `<small class="mx-muted">${[unverified && `${unverified} sans vérificateur`, legacy && `${legacy} ancienne${legacy > 1 ? 's' : ''} note${legacy > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}</small>` : ''}`;
}

function mxApartCell(p) {
  const ev = p.evidence || {};
  const chips = [];
  const outcomes = Object.entries(ev.outcomes || {}).filter(([k]) => MX_OUTCOME[k]);
  if (outcomes.length) chips.push(`<span class="mx-chip" title="Issue donnée par les maîtres à chaque agent">${outcomes.map(([k, c]) => `${c} ${MX_OUTCOME[k]}`).join(', ')}</span>`);
  if (ev.medianRounds != null) chips.push(`<span class="mx-chip" title="Allers-retours de correction, médiane">${ev.medianRounds} aller${ev.medianRounds > 1 ? 's' : ''}-retour${ev.medianRounds > 1 ? 's' : ''}</span>`);
  const ranks = new Map();
  for (const r of ev.ranks || []) ranks.set(`${r.rank}/${r.of}`, (ranks.get(`${r.rank}/${r.of}`) || 0) + 1);
  for (const [k, c] of ranks) chips.push(`<span class="mx-chip" title="Classement en Arène">Arène ${k.replace(/^1\//, '1er/')}${c > 1 ? ` ×${c}` : ''}</span>`);
  if (ev.legacyAvg != null) chips.push(`<span class="mx-chip" title="Anciennes notes des maîtres, figées">anciennes ${ev.legacyAvg.toFixed(1).replace('.', ',')}/5</span>`);
  return chips.join('') || '<span class="mx-muted">—</span>';
}

function mxRow(p, i, cat) {
  const candidate = cat?.coverageCandidate?.key === p.key ? `<span class="mx-candidate" title="${cat.coverageCandidate.mode === 'duel' ? 'Candidat à un duel à côté du premier choix' : 'Candidat à une exploration à la place du premier choix'}">${cat.coverageCandidate.mode === 'duel' ? 'duel' : 'à explorer'}</span>` : '';
  const quota = p.measured?.tokens != null ? `<span title="Estimation : jetons facturés médians, proxy de la consommation du quota">≈ ${mxTokens(p.measured.tokens)} tok</span>` : '<span class="mx-muted">non mesuré</span>';
  const time = p.measured?.durationMs != null ? `<span>${mxDuration(p.measured.durationMs)}</span>` : '<span class="mx-muted">non mesuré</span>';
  const n = p.measured ? `<small class="mx-muted">${mxPlural(p.measured.n, 'mesuré')}</small>` : '';
  return `<tr class="${p.available ? '' : 'mx-off'} ${i === 0 && p.available ? 'mx-first' : ''}"><td class="mx-rank">${i + 1}</td>
    <td><div class="mx-pick">${mxProvider(p.provider)} <span class="mx-model">${esc(p.model)}</span><small>${esc(MX_EFFORT[p.effort] || p.effort || 'défaut')}${p.available ? '' : ' · indisponible'}</small>${candidate}</div></td>
    <td class="mx-scorecell">${mxScoreCell(p)}</td><td><div class="mx-stack">${mxEvidenceCell(p)}</div></td><td><div class="mx-apart">${mxApartCell(p)}</div></td>
    <td><div class="mx-stack">${quota}${n}</div></td><td><div class="mx-stack">${time}</div></td>
    <td>${p.offMatrix ? '<span class="mx-muted">hors matrice</span>' : mxDots(p.score)}</td>
    <td class="mx-why">${esc(p.why)}</td></tr>`;
}

function mxCoverage(cat, data) {
  const c = cat.coverageCandidate;
  const pick = c && cat.picks.find((p) => p.key === c.key);
  if (!pick) return '';
  const week = matrixUi.balance?.[pick.provider === 'codex' ? 'codex' : 'claude']?.weekPercent;
  const first = cat.picks.find((p) => p.available)?.key === pick.key;
  const how = first ? 'il manque de vérifications : lui donner un vérificateur' : c.mode === 'duel' ? `duel à côté du premier choix, sur une tâche courte${Number.isFinite(week) ? `, fenêtre 7 j ${pick.provider === 'codex' ? 'GPT' : 'Claude'} à ${Math.round(week)} %` : ''}` : 'remplace le premier choix sur une tâche réversible et vérifiée';
  return `<p class="mx-coverage"><b>File de couverture</b> · ${mxPlural(data.coverage?.credits || 0, 'crédit')} · candidat <b>${esc(mxLabel(pick))}</b> (${esc(pick.confidence)}) : ${how}.</p>`;
}

function mxVerdicts(cat, data) {
  const rows = (data.recent || []).filter((r) => r.target?.category === cat.id).slice(0, 8);
  if (!rows.length) return '<p class="mx-muted">Pas encore de verdict : les agents de vérification les rendent à la fin de leur tour.</p>';
  const sev = { blocking: 'bloquant', 'to-fix': 'à corriger', suggestion: 'suggestion' };
  return `<ul class="mx-notes">${rows.map((r) => `<li><span class="mx-sev ${r.type === 'clean' ? 'clean' : r.severity}">${r.type === 'clean' ? 'propre' : sev[r.severity] || esc(r.severity)}</span> <b>${esc(r.target.agent || '?')}</b> <span class="mx-muted">${esc(mxLabel(r.target))}</span> ← ${esc(r.judge.agent || '?')} ${esc(MX_ROLE[r.judge.role] || r.judge.role)} <span class="mx-muted">${esc(mxLabel(r.judge))}</span>${r.text ? ` ${esc(r.text)}` : ''}</li>`).join('')}</ul>`;
}

function mxProposals(cat, data) {
  const mine = (data.proposals || []).filter((p) => p.category === cat.id);
  const applied = (data.applied || []).filter((p) => p.category === cat.id).slice(-5).reverse();
  if (!mine.length && !applied.length) return '';
  const label = (p) => `${p.provider === 'codex' ? 'GPT ' : ''}${esc(p.model)} · ${esc(MX_EFFORT[p.effort] || p.effort || 'défaut')}`;
  const done = applied.length ? `<h4>Propositions validées</h4><ul class="mx-notes">${applied.map((p) => `<li><b>${label(p)}</b> ${p.previous ? `${p.previous.score}/5 → ${p.score}/5` : `ajout à ${p.score}/5`} <span class="mx-muted">${esc(p.why || '')} · ${ago(p.decidedAt)}</span> <button class="btn" data-mx-revert="${esc(p.id)}" ${matrixUi.busy ? 'disabled' : ''}>Annuler</button></li>`).join('')}</ul>` : '';
  return `<div class="mx-proposals">${mine.length ? '<h4>Propositions en attente</h4>' : ''}<ul class="mx-notes">${mine.map((p) => `<li><b>${label(p)}</b> ${p.previous ? `${p.previous.score}/5 → ${p.score}/5` : `ajout à ${p.score}/5`} <span class="mx-muted">${esc(p.why || '')} · ${esc(p.author || 'maître')} · ${ago(p.at)}</span> <button class="btn primary" data-mx-validate="${esc(p.id)}" ${matrixUi.busy ? 'disabled' : ''}>Valider</button> <button class="btn" data-mx-reject="${esc(p.id)}" ${matrixUi.busy ? 'disabled' : ''}>Rejeter</button></li>`).join('')}</ul>${done}</div>`;
}

function mxEditRow(p, i) {
  const prov = matrixUi.providers || {};
  const models = (prov[p.provider]?.models || []).map((m) => m.id);
  if (p.model && !models.includes(p.model)) models.unshift(p.model);
  const model = models.find((m) => m === p.model);
  const efforts = (prov[p.provider]?.models || []).find((m) => m.id === model)?.efforts || prov[p.provider]?.efforts || [];
  const opt = (list, value, label = (v) => v) => list.map((v) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(label(v))}</option>`).join('');
  return `<tr data-mx-row="${i}"><td class="mx-rank">${i + 1}</td>
    <td><select data-mx-f="provider">${opt(['claude', 'codex'], p.provider, (v) => (v === 'codex' ? 'GPT' : 'Claude'))}</select></td>
    <td><select data-mx-f="model">${opt(models, p.model)}</select></td>
    <td><select data-mx-f="effort"><option value="">défaut</option>${opt(efforts, p.effort, (v) => MX_EFFORT[v] || v)}</select></td>
    <td><select data-mx-f="score">${opt(['1', '2', '3', '4', '5'], String(p.score))}</select></td>
    <td colspan="2"><input data-mx-f="why" value="${esc(p.why || '')}" maxlength="200" placeholder="Pourquoi ce choix"><button class="mx-x" data-mx-del="${i}" aria-label="Retirer ce choix">×</button></td></tr>`;
}

function renderMatrix() {
  const page = $('matrix-page');
  const data = matrixUi.data;
  if (!data) { page.innerHTML = '<div class="mx-head"><h2>Matrice des modèles</h2><span class="mx-grow"></span><button class="btn" data-mx-close>Fermer</button></div><p class="mx-muted">Chargement…</p>'; return; }
  const edit = matrixUi.edit;
  const cat = edit || data.categories.find((c) => c.id === matrixUi.pick);
  const list = data.categories.map((c) => {
    const top = c.picks.find((p) => p.available);
    return `<button class="mx-cat ${c.id === (edit?.id || matrixUi.pick) ? 'is-on' : ''}" data-mx-pick="${esc(c.id)}"><b>${esc(c.label)}${c.source === 'local' ? ' <span class="mx-local">local</span>' : ''}${(data.proposals || []).some((p) => p.category === c.id) ? ' <span class="mx-local">à valider</span>' : ''}</b><small>${top ? `${top.provider === 'codex' ? 'GPT ' : ''}${esc(top.model)} · ${esc(MX_EFFORT[top.effort] || top.effort || 'défaut')}` : 'aucun choix disponible'}</small></button>`;
  }).join('');
  const detail = !cat ? '<p class="mx-muted">Aucune catégorie.</p>' : edit ? `
      <div class="mx-edit-head">${edit.isNew ? `<input id="mx-id" value="${esc(edit.id)}" placeholder="identifiant (ex. perf)">` : ''}<input id="mx-label" value="${esc(edit.label)}" placeholder="Nom"><input id="mx-desc" value="${esc(edit.description || '')}" placeholder="Description"></div>
      <table class="mx-table"><thead><tr><th>#</th><th>IA</th><th>Modèle</th><th>Effort</th><th>Référence</th><th colspan="2">Pourquoi</th></tr></thead><tbody>${edit.picks.map(mxEditRow).join('')}</tbody></table>
      <div class="mx-buttons"><button class="btn" data-mx-add>+ Ajouter un choix</button><span class="mx-grow"></span><button class="btn" data-mx-cancel>Annuler</button><button class="btn primary" data-mx-save ${matrixUi.busy ? 'disabled' : ''}>Enregistrer</button></div>`
    : `<div class="mx-cat-head"><h3>${esc(cat.label)}</h3><span class="mx-muted">${esc(cat.description || '')}</span><span class="mx-grow"></span>
        ${cat.source === 'local' || (data.maintainer && cat.source === 'published') ? '<button class="btn" data-mx-reset>Revenir au défaut</button>' : ''}<button class="btn" data-mx-edit>Modifier</button></div>
      ${mxProposals(cat, data)}${mxCoverage(cat, data)}<div class="mx-scroll"><table class="mx-table mx-picks"><thead><tr><th>#</th><th>Choix</th><th>Score</th><th>Preuves</th><th>Hors score</th><th title="Estimation : jetons facturés médians, proxy du quota">Coût quota</th><th>Durée</th><th>Réf.</th><th>Pourquoi</th></tr></thead><tbody>${cat.picks.map((p, i) => mxRow(p, i, cat)).join('')}</tbody></table></div>
      <h4>Verdicts récents</h4>${mxVerdicts(cat, data)}`;
  const models = data.models.map((m) => `<div class="mx-model-card"><div class="mx-model-head">${mxProvider(m.provider)} <b>${esc(m.label)}</b></div><span class="mx-muted">coût ${mxLevel(m.cost)} · vitesse ${mxLevel(m.speed)}${m.context ? ` · ${Math.round(m.context / 1000)} k tokens` : ''}</span><small>${esc(m.summary)}</small></div>`).join('');
  page.innerHTML = `<div class="mx-head"><h2>Matrice des modèles</h2>${data.available.codex ? '' : '<button class="mx-pill" data-mx-connect>GPT indisponible : connecter GPT</button>'}<span class="mx-grow"></span><button class="btn" data-mx-new>Nouvelle catégorie</button><button class="btn" data-mx-close>Fermer</button></div>
    <p class="mx-note">${esc(data.note)}</p>
    <div class="mx-body"><nav class="mx-cats">${list}</nav><section class="mx-detail">${detail}</section></div>
    <h3 class="mx-models-title">Modèles</h3><div class="mx-models">${models}</div>`;
}

function readEditRows() {
  const edit = matrixUi.edit;
  if (!edit) return;
  if ($('mx-id')) edit.id = $('mx-id').value.trim();
  if ($('mx-label')) edit.label = $('mx-label').value;
  if ($('mx-desc')) edit.description = $('mx-desc').value;
  document.querySelectorAll('[data-mx-row]').forEach((row) => {
    const p = edit.picks[Number(row.dataset.mxRow)];
    row.querySelectorAll('[data-mx-f]').forEach((el) => { p[el.dataset.mxF] = el.dataset.mxF === 'score' ? Number(el.value) : el.value || null; });
  });
}

$('matrix-page').addEventListener('click', async (e) => {
  const t = e.target;
  if (t.closest('[data-mx-close]')) { $('matrix-dialog').close(); return; }
  if (t.closest('[data-mx-connect]')) { $('matrix-dialog').close(); openMcp(); return; }
  const pick = t.closest('[data-mx-pick]');
  if (pick && !matrixUi.edit) { matrixUi.pick = pick.dataset.mxPick; renderMatrix(); return; }
  if (t.closest('[data-mx-edit]')) {
    const c = matrixUi.data.categories.find((x) => x.id === matrixUi.pick);
    matrixUi.edit = { id: c.id, label: c.label, description: c.description, picks: c.picks.filter((p) => !p.offMatrix).sort((a, b) => b.score - a.score).map(({ provider, model, effort, score, why }) => ({ provider, model, effort, score, why })) };
    renderMatrix();
    return;
  }
  if (t.closest('[data-mx-new]')) { matrixUi.edit = { isNew: true, id: '', label: '', description: '', picks: [] }; renderMatrix(); $('mx-id').focus(); return; }
  if (t.closest('[data-mx-cancel]')) { matrixUi.edit = null; renderMatrix(); return; }
  if (t.closest('[data-mx-add]')) { readEditRows(); matrixUi.edit.picks.push({ provider: 'claude', model: 'sonnet', effort: 'medium', score: 3, why: '' }); renderMatrix(); return; }
  const del = t.closest('[data-mx-del]');
  if (del) { readEditRows(); matrixUi.edit.picks.splice(Number(del.dataset.mxDel), 1); renderMatrix(); return; }
  if (t.closest('[data-mx-save]')) {
    readEditRows();
    matrixUi.busy = true;
    const { isNew, ...body } = matrixUi.edit;
    const result = await post('/api/matrix/category', body);
    matrixUi.busy = false;
    if (!result.ok) { toast(result.data.error || 'Enregistrement impossible.', 'error'); renderMatrix(); return; }
    matrixUi.pick = body.id;
    matrixUi.edit = null;
    toast('Matrice enregistrée.');
    loadMatrix();
    return;
  }
  const decide = t.closest('[data-mx-validate], [data-mx-reject], [data-mx-revert]');
  if (decide) {
    if (matrixUi.busy) return;
    const decision = decide.hasAttribute('data-mx-validate') ? 'validate' : decide.hasAttribute('data-mx-reject') ? 'reject' : 'revert';
    matrixUi.busy = true;
    renderMatrix();
    const result = await post('/api/matrix/proposal', { id: decide.dataset.mxValidate || decide.dataset.mxReject || decide.dataset.mxRevert, decision });
    matrixUi.busy = false;
    toast(result.ok ? { validate: 'Proposition validée.', reject: 'Proposition rejetée.', revert: 'Proposition annulée.' }[decision] : result.data.error || 'Impossible.', result.ok ? '' : 'error');
    loadMatrix();
    return;
  }
  if (t.closest('[data-mx-reset]')) {
    if (!confirm('Revenir aux choix par défaut pour cette catégorie ?')) return;
    const result = await post('/api/matrix/reset', { id: matrixUi.pick });
    toast(result.ok ? 'Catégorie revenue au défaut.' : result.data.error || 'Impossible.', result.ok ? '' : 'error');
    loadMatrix();
  }
});

// Changing the provider or the model refreshes the model and effort lists of that row.
$('matrix-page').addEventListener('change', (e) => {
  const field = e.target.dataset?.mxF;
  if (!matrixUi.edit || !['provider', 'model'].includes(field)) return;
  readEditRows();
  const p = matrixUi.edit.picks[Number(e.target.closest('[data-mx-row]').dataset.mxRow)];
  const prov = matrixUi.providers?.[p.provider];
  if (field === 'provider') p.model = prov?.models?.[0]?.id || null;
  const efforts = prov?.models?.find((m) => m.id === p.model)?.efforts || prov?.efforts || [];
  if (p.effort && !efforts.includes(p.effort)) p.effort = null;
  renderMatrix();
});
