function openClose(wtPath) {
  const wt = state.worktrees.find((w) => w.path === wtPath);
  if (!wt) return;
  closing = { path: wt.path, force: false };
  $('close-title').textContent = `Fermer ${wt.name}`;
  const live = wt.sessions.filter((s) => s.live).length;
  $('close-text').textContent = `Le dossier ${wt.path} sera supprimé avec git worktree remove${live ? `, et ${live} session${live > 1 ? 's' : ''} Claude ouverte${live > 1 ? 's' : ''} dans tmux sera arrêtée` : ''}. La branche ${wt.branch || '(aucune)'} est conservée, sauf si tu coches la case.`;
  $('close-warn').hidden = true;
  $('close-branch').checked = false;
  $('close-submit').textContent = 'Fermer le worktree';
  $('close-dialog').showModal();
}

const newKind = () => $('new-form').elements.kind.value;
let providersCache = null;
const MODE_LABEL = { default: 'Par défaut', acceptEdits: 'Accepter les modifs', auto: 'Auto', plan: 'Plan (lecture seule)' };
const EFFORT_LABEL = { low: 'Bas', medium: 'Moyen', high: 'Élevé', xhigh: 'Très élevé', max: 'Max', ultra: 'Ultra' };

async function loadProviders() {
  const res = await api('/api/providers').catch(() => null);
  if (res?.ok) providersCache = await res.json();
  fillProviderFields();
}

function fillProviderFields() {
  const p = providersCache;
  const codex = p?.codex;
  const option = $('new-provider').querySelector('option[value="codex"]');
  option.disabled = !codex?.available;
  option.textContent = codex?.available ? 'GPT (Codex)' : 'GPT (à connecter : ⋯ → Connexions)';
  if (option.disabled && $('new-provider').value === 'codex') $('new-provider').value = 'claude';
  const current = p?.[$('new-provider').value];
  const opts = (list, label) => list.map((v) => `<option value="${esc(v.id || v)}">${esc(v.label || label?.[v] || v)}</option>`).join('');
  $('new-model').innerHTML = `<option value="">Par défaut</option>${opts(current?.models || [])}`;
  fillEfforts();
  $('new-mode').innerHTML = opts(current?.modes || ['default', 'acceptEdits', 'auto', 'plan'], MODE_LABEL);
  $('new-mode').value = $('new-provider').value === 'codex' ? 'acceptEdits' : 'default';
}

// Only the efforts the chosen model takes (Codex lists them per model).
function fillEfforts() {
  const current = providersCache?.[$('new-provider').value];
  const model = current?.models?.find((m) => m.id === $('new-model').value);
  const efforts = model?.efforts?.length ? model.efforts : current?.efforts || [];
  const keep = $('new-effort').value;
  $('new-effort').innerHTML = `<option value="">Par défaut</option>${efforts.map((e) => `<option value="${esc(e)}">${esc(EFFORT_LABEL[e] || e)}</option>`).join('')}`;
  if (efforts.includes(keep)) $('new-effort').value = keep;
}

$('new-provider').addEventListener('change', fillProviderFields);
$('new-model').addEventListener('change', fillEfforts);

function syncNewKind() {
  const review = newKind() === 'review';
  const master = newKind() === 'master';
  $('orch-new').hidden = !master;
  $('provider-new').hidden = newKind() !== 'session';
  $('new-prompt').required = master;
  $('new-prompt-label').textContent = master ? 'Objectif' : 'Premier message (optionnel)';
  $('new-pr-label').hidden = !review;
  $('new-pr').required = review;
  $('new-variants-label').hidden = review || master || !!delegateParent;
  $('new-prompt').placeholder = review ? 'Consignes en plus pour la review (optionnel)' : master ? 'L’objectif : le maître propose un plan, puis lance ses agents' : 'Ce que Claude doit faire';
}

$('new-kinds').addEventListener('change', () => { syncNewKind(); (newKind() === 'review' ? $('new-pr') : $('new-worktree')).focus(); });
$('new-pr').addEventListener('input', () => {
  const n = $('new-pr').value.trim().match(/(?:pull\/|^#?)(\d+)/);
  if (n && (!$('new-worktree').value || /^review-\d*$/.test($('new-worktree').value))) $('new-worktree').value = `review-${n[1]}`;
});

$('new-btn').addEventListener('click', () => openNewSession());

$('new-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const worktree = $('new-worktree').value.trim();
  const variants = newKind() === 'session' && !delegateParent ? Math.max(1, Math.min(5, Number($('new-variants').value) || 1)) : 1;
  const names = variants > 1 ? Array.from({ length: variants }, (_, i) => `${worktree}-v${i + 1}`) : [worktree];
  const parent = delegateParent ? { sessionId: delegateParent.sessionId, notify: $('new-notify').checked } : null;
  $('new-submit').disabled = true;
  if (newKind() === 'master') {
    const result = await post('/api/orch/start', { worktree, prompt: $('new-prompt').value, model: $('orch-model').value, effort: $('orch-effort').value, autonomy: $('orch-autonomy').value, maxAgents: Number($('orch-max').value), agentMode: $('orch-mode').value, arena: $('orch-arena').checked, strictMaster: $('orch-strict').checked });
    $('new-submit').disabled = false;
    if (!result.ok) { toast(`${worktree} : ${result.data.error || 'lancement impossible'}`, 'error'); return; }
    $('new-dialog').close();
    pendingSelect = worktree;
    toast(`Maître lancé dans ${worktree}.`);
    setTimeout(refresh, 2500);
    return;
  }
  const started = [];
  for (const name of names) {
    const chosen = newKind() === 'session' ? { provider: $('new-provider').value, model: $('new-model').value || undefined, effort: $('new-effort').value || undefined, mode: $('new-mode').value || undefined } : {};
    const result = await post('/api/start', { worktree: name, prompt: $('new-prompt').value, kind: newKind(), pr: $('new-pr').value, parent, ...chosen });
    if (!result.ok) { toast(`${name} : ${result.data.error || 'lancement impossible'}`, 'error'); break; }
    started.push(name);
  }
  $('new-submit').disabled = false;
  if (!started.length) return;
  $('new-dialog').close();
  delegateParent = null;
  pendingSelect = started[0];
  toast(started.length > 1 ? `${started.length} variantes lancées : ${started.join(', ')}.` : `Session lancée dans tmux (${started[0]}). Elle s'ouvre dès qu'elle a démarré.`);
  setTimeout(refresh, 2500);
});

$('close-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!closing) return;
  $('close-submit').disabled = true;
  const result = await post('/api/close', { path: closing.path, force: closing.force, deleteBranch: $('close-branch').checked });
  $('close-submit').disabled = false;
  if (result.status === 409 && result.data.dirty) {
    closing.force = true;
    $('close-warn').textContent = 'Ce worktree a des changements non commités. Ils seront définitivement perdus si tu continues.';
    $('close-warn').hidden = false;
    $('close-submit').textContent = 'Supprimer quand même';
    return;
  }
  if (!result.ok) { toast(result.data.error || 'Fermeture impossible.', 'error'); return; }
  $('close-dialog').close();
  if (selected === closing.path) closePanel();
  toast(result.data.warning || 'Worktree fermé.', result.data.warning ? 'error' : '');
  closing = null;
  refresh();
});

async function archive(wtPath) {
  const wt = state.worktrees.find((w) => w.path === wtPath);
  if (!wt || !confirm(`Archiver ${wt.name} ?\n\nLes sessions tmux s'arrêtent et le dossier est retiré. La branche ⎇ ${wt.branch || '(détachée)'} et la conversation sont gardées : « Restaurer » les remet en place.`)) return;
  const result = await post('/api/archive', { path: wtPath });
  toast(result.ok ? `${wt.name} archivé.` : result.data.error || 'Archivage impossible.', result.ok ? '' : 'error');
  if (result.ok && selected === wtPath) closePanel();
  refresh();
}

async function unarchive(archivedPath, resume) {
  const name = (state.archives || []).find((a) => a.path === archivedPath)?.name || archivedPath.split('/').pop();
  const result = await post('/api/unarchive', { path: archivedPath, resume });
  toast(result.ok ? (result.data.warning || `${name} restauré${resume ? ', la session reprend dans tmux' : ''}.`) : result.data.error || 'Restauration impossible.', result.ok && !result.data.warning ? '' : 'error');
  if (result.ok && resume) pendingSelect = name;
  refresh();
}

async function openCleanup() {
  $('cleanup-table').innerHTML = '<div class="placeholder">Analyse des worktrees…</div>';
  openPage($('cleanup-dialog'));
  const res = await api('/api/cleanup').catch(() => null);
  cleanupRows = res?.ok ? await res.json() : [];
  cleanupRows.sort((a, b) => a.lastActivity - b.lastActivity);
  const size = (kb) => (kb == null ? '…' : kb > 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} Go` : `${Math.round(kb / 1024)} Mo`);
  $('cleanup-table').innerHTML = cleanupRows.length ? `<table class="cleanup-table"><thead><tr><th></th><th>Worktree</th><th>Branche</th><th>Inactif depuis</th><th>Taille</th><th>État</th></tr></thead><tbody>${cleanupRows.map((r, i) => {
    const statuses = [
      r.dirty ? `<span class="bad">${r.dirty} non commité${r.dirty > 1 ? 's' : ''}</span>` : '',
      r.ahead && !r.merged ? `<span class="bad">${r.ahead} non poussé${r.ahead > 1 ? 's' : ''}</span>` : '',
      r.merged ? '<span class="ok">mergée</span>' : '',
      r.pr ? `PR #${r.pr.number} ${esc(r.pr.state.toLowerCase())}` : '',
      r.live ? 'session ouverte' : '',
    ].filter(Boolean).join(' · ') || 'propre';
    return `<tr><td><input type="checkbox" data-cleanup="${i}" ${r.dirty || r.locked ? 'disabled' : ''} aria-label="Sélectionner ${esc(r.name)}"></td><td><b>${esc(r.name)}</b></td><td>${esc(r.branch || '—')}</td><td>${ago(r.lastActivity)}</td><td>${size(r.sizeKb)}</td><td>${statuses}</td></tr>`;
  }).join('')}</tbody></table>` : '<div class="placeholder">Aucun worktree à nettoyer.</div>';
  if (cleanupRows.some((r) => r.sizeKb == null)) setTimeout(() => { if ($('cleanup-dialog').open) openCleanup(); }, 8000);
}

async function bulkCleanup(mode) {
  const rows = [...document.querySelectorAll('[data-cleanup]:checked')].map((b) => cleanupRows[Number(b.dataset.cleanup)]).filter(Boolean);
  const eligible = mode === 'close' ? rows.filter((r) => r.merged && !r.dirty) : rows.filter((r) => !r.dirty);
  if (!eligible.length) { toast(mode === 'close' ? 'Seules les branches mergées et propres peuvent être fermées ici.' : 'Rien à archiver dans la sélection.', 'error'); return; }
  if (!confirm(`${mode === 'close' ? 'Fermer (et supprimer la branche mergée de)' : 'Archiver'} : ${eligible.map((r) => r.name).join(', ')} ?`)) return;
  const failed = [];
  for (const r of eligible) {
    const result = await post(mode === 'close' ? '/api/close' : '/api/archive', { path: r.path, deleteBranch: true });
    if (!result.ok) failed.push(`${r.name} : ${result.data.error || 'échec'}`);
  }
  toast(failed.length ? `Échecs : ${failed.join(' · ')}` : `${eligible.length} worktree${eligible.length > 1 ? 's' : ''} ${mode === 'close' ? 'fermé' : 'archivé'}${eligible.length > 1 ? 's' : ''}.`, failed.length ? 'error' : '');
  refresh();
  openCleanup();
}

function openNewSession({ prompt = '', parent = null } = {}) {
  $('new-form').reset();
  syncNewKind();
  fillProviderFields();
  loadProviders();
  delegateParent = parent;
  $('new-prompt').value = prompt;
  $('new-parent').hidden = !parent;
  $('new-notify-label').hidden = !parent;
  $('new-variants-label').hidden = !!parent;
  if (parent) $('new-parent').textContent = `Session déléguée depuis ${parent.worktree} : elle apparaîtra liée à sa session parente.`;
  $('new-dialog').showModal();
  $('new-worktree').focus();
}

function delegate(index) {
  const item = chatItems[index];
  const wt = currentWt();
  const s = currentSession();
  if (!item || !wt || !s) return;
  openNewSession({ parent: { sessionId: s.sessionId, worktree: wt.name }, prompt: `Contexte (session parente « ${wt.name} », branche ${wt.branch || '?'}) :\n> ${item.text.slice(0, 1200).replace(/\n/g, '\n> ')}\n\nSous-tâche : ` });
}

$('cleanup-archive').addEventListener('click', () => bulkCleanup('archive'));
$('cleanup-close').addEventListener('click', () => bulkCleanup('close'));
