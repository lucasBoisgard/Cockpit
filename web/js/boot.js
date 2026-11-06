async function refresh() {
  try {
    const res = await api('/api/state');
    if (res.status === 401) { $('updated').textContent = 'accès refusé : ouvre l’URL avec ?token= affichée par start.sh'; return; }
    state = await res.json();
  } catch {
    $('updated').textContent = 'serveur injoignable';
    return;
  }
  trackBranches();
  if (pendingSelect) {
    const wt = state.worktrees.find((w) => w.name === pendingSelect && w.sessions.some((s) => s.live));
    if (wt) { select(wt.path); pendingSelect = null; }
  }
  if (pendingParallel) {
    const wt = state.worktrees.find((w) => w.path === pendingParallel.path);
    const fresh = wt?.sessions.find((s) => !pendingParallel.known.has(s.sessionId));
    if (fresh && selected === wt.path) { chatSession = fresh.sessionId; chatBarSignature = null; loadChat(true); }
    if (fresh || Date.now() - pendingParallel.at > 60000) pendingParallel = null;
  }
  if (selected && selected !== SHELL && selected !== USAGE && !currentWt()) selected = null;
  ensureSelection();
  if (currentWt()) dropLostRepo();
  renderCounters(); renderGrid(); renderPanel();
  updateTitle();
  checkEvents();
  if (selected === USAGE) loadUsage();
  if (currentWt() && tab === 'chat') loadChat(false);
  if (currentWt() && tab === 'checks' && Date.now() - checksLoadedAt > 20000) loadChecks();
  if (currentWt()) refreshSinceFiles();
}

$('restart-btn').addEventListener('click', async () => {
  const btn = $('restart-btn');
  btn.disabled = true;
  btn.textContent = 'Redémarrage…';
  const result = await post('/api/restart', {});
  if (!result.ok) { btn.disabled = false; btn.textContent = 'Recharger le cockpit'; toast(result.data.error || 'Redémarrage impossible.', 'error'); return; }
  for (let i = 0; i < 60; i++) {
    try {
      const res = await api('/api/state');
      if (res.ok && (await res.json()).startedAt !== result.data.startedAt) { location.reload(); return; }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  btn.disabled = false;
  btn.textContent = 'Recharger le cockpit';
  toast('Le cockpit ne répond pas : regarde server.log ou relance start.sh.', 'error');
});

document.querySelectorAll('dialog [data-dismiss]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

$('tools-menu').addEventListener('click', (e) => {
  const b = e.target.closest('[data-tool]');
  if (!b) return;
  $('tools-menu').open = false;
  ({ history: openHistory, cleanup: openCleanup, automations: () => { fillAutomationForm(null); openAutomations(); }, select: startSelecting, palette: openPalette, layout: () => setLayout(isWorkstation() ? 'cards' : 'workstation'), skills: openSkills, mcp: openMcp, matrix: openMatrix, help: () => $('help-dialog').showModal() })[b.dataset.tool]?.();
});
document.addEventListener('click', (e) => { if (!e.target.closest('#tools-menu')) $('tools-menu').open = false; });

refresh();
setInterval(refresh, 3000);
setInterval(() => { if ($('panel').classList.contains('open') && ['term', 'app'].includes(tab)) loadScreen(); }, 700);
