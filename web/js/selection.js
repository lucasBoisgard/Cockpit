function openBroadcast() {
  const targets = [...picked].map((p) => state.worktrees.find((w) => w.path === p)).filter(Boolean);
  const live = targets.filter((w) => liveSession(w));
  if (!live.length) { toast('Aucune session pilotable dans la sélection.', 'error'); return; }
  $('broadcast-targets').textContent = `${live.length} session${live.length > 1 ? 's' : ''} : ${live.map((w) => w.name).join(', ')}${targets.length > live.length ? ` (${targets.length - live.length} sans session pilotable, ignorée${targets.length - live.length > 1 ? 's' : ''})` : ''}`;
  $('broadcast-form').dataset.targets = JSON.stringify(live.map((w) => liveSession(w).sessionId));
  $('broadcast-dialog').showModal();
  $('broadcast-text').focus();
}

function startSelecting() {
  selecting = true;
  picked.clear();
  renderBoard();
}

function stopSelecting() {
  selecting = false;
  picked.clear();
  renderBoard();
}

$('broadcast-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const targets = parseJson($('broadcast-form').dataset.targets, []);
  const result = await post('/api/broadcast', { targets, text: $('broadcast-text').value });
  if (!result.ok) { toast(result.data.error || 'Envoi impossible.', 'error'); return; }
  $('broadcast-dialog').close();
  $('broadcast-text').value = '';
  stopSelecting();
  const r = result.data;
  toast(`Envoyé à ${r.sent.length} · en file pour ${r.queued.length}${r.offline.length ? ` · ${r.offline.length} hors tmux` : ''}.`);
  refresh();
});

$('select-write').addEventListener('click', openBroadcast);
$('select-cancel').addEventListener('click', stopSelecting);
$('select-idle').addEventListener('click', () => {
  for (const w of state.worktrees) if (liveSession(w) && ['done', 'idle'].includes(liveSession(w).status)) picked.add(w.path);
  renderBoard();
});
