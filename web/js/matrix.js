// Relevance matrix page: which provider, model and effort fits which kind of task, the ratings masters gave
// their agents, and local edits on top of the versioned default.
const matrixUi = { data: null, providers: null, pick: null, edit: null, busy: false };
const MX_EFFORT = { low: 'Bas', medium: 'Moyen', high: 'Élevé', xhigh: 'Très élevé', max: 'Max', ultra: 'Ultra' };

async function loadMatrix() {
  const [m, p] = await Promise.all([api('/api/matrix').then((r) => (r.ok ? r.json() : null)).catch(() => null), api('/api/providers').then((r) => (r.ok ? r.json() : null)).catch(() => null)]);
  if (!m) { toast('Lecture de la matrice impossible.', 'error'); return; }
  matrixUi.data = m;
  matrixUi.providers = p;
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
const mxLevel = (n) => (n == null ? '—' : ['', 'bas', 'moyen', 'élevé'][n] || n);

function mxRow(p, i) {
  const obs = p.observed ? `<span class="mx-obs ${p.observed.avg >= p.score ? 'up' : 'down'}" title="${esc(p.observed.notes.map((n) => `${n.score}/5 · ${n.note}`).join('\n'))}">${p.observed.avg}/5 <small>sur ${p.observed.n}</small></span>` : '<span class="mx-muted">—</span>';
  return `<tr class="${p.available ? '' : 'mx-off'}"><td class="mx-rank">${i + 1}</td><td>${mxProvider(p.provider)}</td><td class="mx-model">${esc(p.model)}</td><td>${esc(MX_EFFORT[p.effort] || p.effort || 'défaut')}</td><td>${mxDots(p.score)}</td><td>${obs}</td><td class="mx-why">${esc(p.why)}${p.available ? '' : ' <span class="mx-muted">· indisponible</span>'}</td></tr>`;
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
    return `<button class="mx-cat ${c.id === (edit?.id || matrixUi.pick) ? 'is-on' : ''}" data-mx-pick="${esc(c.id)}"><b>${esc(c.label)}${c.source === 'local' ? ' <span class="mx-local">local</span>' : ''}</b><small>${top ? `${top.provider === 'codex' ? 'GPT ' : ''}${esc(top.model)} · ${esc(MX_EFFORT[top.effort] || top.effort || 'défaut')}` : 'aucun choix disponible'}</small></button>`;
  }).join('');
  const notes = cat && !edit ? data.recent.filter((r) => r.category === cat.id).slice(0, 8) : [];
  const detail = !cat ? '<p class="mx-muted">Aucune catégorie.</p>' : edit ? `
      <div class="mx-edit-head">${edit.isNew ? `<input id="mx-id" value="${esc(edit.id)}" placeholder="identifiant (ex. perf)">` : ''}<input id="mx-label" value="${esc(edit.label)}" placeholder="Nom"><input id="mx-desc" value="${esc(edit.description || '')}" placeholder="Description"></div>
      <table class="mx-table"><thead><tr><th>#</th><th>IA</th><th>Modèle</th><th>Effort</th><th>Score</th><th colspan="2">Pourquoi</th></tr></thead><tbody>${edit.picks.map(mxEditRow).join('')}</tbody></table>
      <div class="mx-buttons"><button class="btn" data-mx-add>+ Ajouter un choix</button><span class="mx-grow"></span><button class="btn" data-mx-cancel>Annuler</button><button class="btn primary" data-mx-save ${matrixUi.busy ? 'disabled' : ''}>Enregistrer</button></div>`
    : `<div class="mx-cat-head"><h3>${esc(cat.label)}</h3><span class="mx-muted">${esc(cat.description || '')}</span><span class="mx-grow"></span>
        ${cat.source === 'local' ? '<button class="btn" data-mx-reset>Revenir au défaut</button>' : ''}<button class="btn" data-mx-edit>Modifier</button></div>
      <table class="mx-table"><thead><tr><th>#</th><th>IA</th><th>Modèle</th><th>Effort</th><th>Référence</th><th>Observé</th><th>Pourquoi</th></tr></thead><tbody>${cat.picks.map(mxRow).join('')}</tbody></table>
      <h4>Notes des maîtres</h4>${notes.length ? `<ul class="mx-notes">${notes.map((n) => `<li>${mxDots(n.score)} <b>${n.provider === 'codex' ? 'GPT ' : ''}${esc(n.model || '?')} · ${esc(n.effort || 'défaut')}</b> ${esc(n.note || '')} <span class="mx-muted">${esc(n.agent || '')} · ${esc(n.worktree || '')} · ${ago(n.at)}</span></li>`).join('')}</ul>` : '<p class="mx-muted">Pas encore de note : les maîtres notent leurs agents avec « orchestrate rate ».</p>'}`;
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
    matrixUi.edit = { id: c.id, label: c.label, description: c.description, picks: [...c.picks].sort((a, b) => b.score - a.score).map(({ provider, model, effort, score, why }) => ({ provider, model, effort, score, why })) };
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
