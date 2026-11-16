let merging = null;
let mergeTarget = null;
let mergeInFlight = false;
let mergeSignature = '';
const MERGE_FILTER_FROM = 7;
const MERGE_REFRESH_MS = 2000;

function mergeTargets(source) {
  const rank = (w) => (w.sessions.some((s) => s.live) ? 0 : w.sessions.length ? 1 : 2);
  const lastActivity = (w) => Math.max(0, ...w.sessions.map((s) => s.updatedAt || 0));
  return state.worktrees
    .filter((w) => w.path !== source.path && w.repoName === source.repoName)
    .sort((a, b) => rank(a) - rank(b) || lastActivity(b) - lastActivity(a));
}

function visibleMergeTargets(source) {
  const query = $('merge-filter').value.trim().toLowerCase();
  return mergeTargets(source).filter((w) => !query || `${w.name} ${w.label || ''} ${w.branch || ''}`.toLowerCase().includes(query));
}

function mergeTargetState(target) {
  if (target.sessions.some((s) => s.live)) return { cls: 'live', label: 'Session ouverte' };
  if (target.sessions.length) return { cls: 'stopped', label: 'Session arrêtée' };
  return { cls: 'empty', label: 'Aucune conversation' };
}

function mergeHow(target) {
  const name = esc(target.label || target.name);
  if (target.sessions.some((s) => s.live)) return `La session ouverte de <b>${name}</b> reçoit le contexte, en file si elle attend une réponse.`;
  if (target.sessions.length) return `La dernière conversation de <b>${name}</b> reprend dans tmux, puis reçoit le contexte.`;
  return `Une nouvelle session démarre dans <b>${name}</b> avec le contexte.`;
}

// A plain label, not prChip: a link inside a radio label would steal the click and add a Tab stop.
const mergePrLabel = (pr) => (pr ? `<span class="merge-pr">#${esc(String(pr.number))}${pr.state === 'MERGED' ? ' mergée' : pr.state === 'CLOSED' ? ' fermée' : ''}</span>` : '');

function renderMergeSource(source) {
  const conversations = source.sessions.length;
  const live = source.sessions.filter((s) => s.live).length;
  const facts = [
    source.ahead ? `${source.ahead} commit${source.ahead > 1 ? 's' : ''} non poussé${source.ahead > 1 ? 's' : ''}` : source.upstream ? 'tout est poussé' : 'branche jamais poussée',
    `${conversations} conversation${conversations > 1 ? 's' : ''}`,
    live ? `${live} session${live > 1 ? 's' : ''} ouverte${live > 1 ? 's' : ''} ser${live > 1 ? 'ont' : 'a'} arrêtée${live > 1 ? 's' : ''}` : '',
  ].filter(Boolean);
  $('merge-source').innerHTML = `<div class="merge-source-name">${esc(source.label || source.name)}</div>
    <div class="merge-chips">${branchChip(source)}${prChip(source.pr)}</div>
    <div class="merge-facts">${facts.map(esc).join(' · ')}</div>`;
}

function renderMergeTargets() {
  const source = state.worktrees.find((w) => w.path === merging);
  if (!source) return;
  const targets = visibleMergeTargets(source);
  if (!targets.some((w) => w.path === mergeTarget)) mergeTarget = null;
  $('merge-targets').innerHTML = targets.length ? targets.map((w) => {
    const st = mergeTargetState(w);
    return `<label class="merge-target">
      <input type="radio" name="merge-target" value="${esc(w.path)}" ${w.path === mergeTarget ? 'checked' : ''} ${mergeInFlight ? 'disabled' : ''}>
      <span class="merge-target-body">
        <span class="merge-target-name">${esc(w.label || w.name)}</span>
        <span class="merge-chips">${branchChip(w)}${mergePrLabel(w.pr)}</span>
      </span>
      <span class="merge-state merge-state-${st.cls}">${st.label}</span>
    </label>`;
  }).join('') : '<div class="merge-none">Aucun worktree ne correspond.</div>';
  renderMergeSteps();
}

function renderMergeSteps() {
  const source = state.worktrees.find((w) => w.path === merging);
  const target = state.worktrees.find((w) => w.path === mergeTarget);
  const sourceName = source ? esc(source.label || source.name) : '';
  $('merge-filter').disabled = mergeInFlight;
  $('merge-submit').disabled = mergeInFlight || !target;
  $('merge-submit').textContent = mergeInFlight ? 'Fusion…' : target ? `Fusionner dans ${target.label || target.name}` : 'Fusionner';
  $('merge-steps').innerHTML = target && source ? `
    <li><b>${sourceName}</b> est archivé : ses sessions s’arrêtent, la branche reste, « Restaurer » le remet en place.</li>
    <li>${mergeHow(target)} Il contient la branche, les commits, les dernières réponses et le chemin des conversations.</li>
    <li>Si la cible ne peut pas le recevoir, la fusion est annulée et <b>${sourceName}</b> est restauré si possible.</li>` : '<li class="merge-pending">Choisis la cible pour voir ce qui va se passer.</li>';
}

function mergeStateSignature() {
  const source = state.worktrees.find((w) => w.path === merging);
  if (!source) return 'gone';
  return JSON.stringify([source.ahead, source.upstream, source.pr?.state, source.sessions.map((s) => [s.sessionId, s.live]), mergeTargets(source).map((w) => [w.path, w.branch, w.pr?.state, mergeTargetState(w).cls])]);
}

// The board refreshes `state` in the background: redraw only when something shown has changed, so the
// focus and the selection survive.
function refreshOpenMerge() {
  if (!$('merge-dialog').open || mergeInFlight) return;
  if (!state.worktrees.some((w) => w.path === merging)) { $('merge-dialog').close(); toast('Le worktree à fusionner a disparu.', 'error'); return; }
  const signature = mergeStateSignature();
  if (signature === mergeSignature) return;
  mergeSignature = signature;
  const focused = document.activeElement?.value;
  renderMergeSource(state.worktrees.find((w) => w.path === merging));
  renderMergeTargets();
  if (focused) $('merge-targets').querySelector(`input[value="${CSS.escape(focused)}"]`)?.focus();
}

function openMerge(wtPath) {
  const source = state.worktrees.find((w) => w.path === wtPath);
  if (!source || mergeInFlight) return;
  const targets = mergeTargets(source);
  if (!targets.length) { toast('Aucun autre worktree de ce repo où fusionner.', 'error'); return; }
  merging = source.path;
  mergeTarget = null;
  $('merge-title').textContent = `Fusionner ${source.label || source.name}`;
  $('merge-filter').value = '';
  $('merge-filter').hidden = targets.length < MERGE_FILTER_FROM;
  mergeSignature = mergeStateSignature();
  renderMergeSource(source);
  renderMergeTargets();
  $('merge-dialog').showModal();
  ($('merge-filter').hidden ? $('merge-targets').querySelector('input') : $('merge-filter'))?.focus();
}

setInterval(refreshOpenMerge, MERGE_REFRESH_MS);

$('merge-filter').addEventListener('input', renderMergeTargets);

// Enter in the filter must never submit: it picks the only match, so the merge stays one explicit click.
$('merge-filter').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const radios = $('merge-targets').querySelectorAll('input[name="merge-target"]');
  if (radios.length !== 1) return;
  radios[0].checked = true;
  mergeTarget = radios[0].value;
  radios[0].focus();
  renderMergeSteps();
});

$('merge-targets').addEventListener('change', (e) => {
  if (e.target.name !== 'merge-target' || mergeInFlight) return;
  mergeTarget = e.target.value;
  renderMergeSteps();
});

$('merge-dialog').addEventListener('close', () => {
  if (!mergeInFlight) merging = null;
});

$('merge-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const source = merging;
  const target = state.worktrees.find((w) => w.path === mergeTarget);
  if (!source || !target || mergeInFlight) return;
  mergeInFlight = true;
  renderMergeTargets();
  const result = await post('/api/merge', { source, target: target.path });
  mergeInFlight = false;
  if (!result.ok) {
    toast(result.data.error || 'Fusion impossible.', 'error');
    if ($('merge-dialog').open) { mergeSignature = ''; refreshOpenMerge(); } else merging = null;
    refresh();
    return;
  }
  if ($('merge-dialog').open) $('merge-dialog').close();
  merging = null;
  if (selected === source) closePanel();
  toast(`Fusionné dans ${target.label || target.name}.`);
  pendingSelect = target.name;
  refresh();
});
