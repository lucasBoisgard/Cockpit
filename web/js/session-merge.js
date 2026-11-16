let merging = null;

function mergeTargets(source) {
  return state.worktrees.filter((w) => w.path !== source.path && w.repoName === source.repoName);
}

function mergeHow(target) {
  if (!target) return '';
  if (target.sessions.some((s) => s.live)) return `La session ouverte de ${target.name} reçoit le contexte (en file si elle attend une réponse).`;
  if (target.sessions.length) return `La dernière conversation de ${target.name} reprend dans tmux, puis reçoit le contexte.`;
  return `${target.name} n’a pas de conversation : une nouvelle session démarre avec le contexte.`;
}

function openMerge(wtPath) {
  const source = state.worktrees.find((w) => w.path === wtPath);
  if (!source) return;
  const targets = mergeTargets(source);
  if (!targets.length) { toast('Aucun autre worktree de ce repo où fusionner.', 'error'); return; }
  merging = source.path;
  $('merge-title').textContent = `Fusionner ${source.name}`;
  $('merge-target').innerHTML = targets.map((w) => `<option value="${esc(w.path)}">${esc(w.label || w.name)}${w.branch ? ` · ⎇ ${esc(w.branch)}` : ''}</option>`).join('');
  $('merge-how').textContent = mergeHow(targets[0]);
  $('merge-submit').disabled = false;
  $('merge-dialog').showModal();
  $('merge-target').focus();
}

$('merge-target').addEventListener('change', () => {
  $('merge-how').textContent = mergeHow(state.worktrees.find((w) => w.path === $('merge-target').value));
});

$('merge-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!merging) return;
  const target = state.worktrees.find((w) => w.path === $('merge-target').value);
  $('merge-submit').disabled = true;
  const result = await post('/api/merge', { source: merging, target: target?.path });
  $('merge-submit').disabled = false;
  if (!result.ok) { toast(result.data.error || 'Fusion impossible.', 'error'); return; }
  $('merge-dialog').close();
  if (selected === merging) closePanel();
  merging = null;
  toast(result.data.warning || `Fusionné dans ${target?.name || 'la cible'}.`, result.data.warning ? 'error' : '');
  if (target) pendingSelect = target.name;
  refresh();
});
