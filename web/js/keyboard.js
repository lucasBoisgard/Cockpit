document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    if (document.activeElement === $('screen')) return;
    e.preventDefault();
    openPalette();
    return;
  }
  const el = document.activeElement;
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]') || el === $('screen') || el?.closest?.('input, textarea, select, [contenteditable]')) return;
  const panelOpen = $('panel').classList.contains('open');
  if ((e.key === 'j' || e.key === 'k') && panelOpen && tab === 'changes') { e.preventDefault(); stepFile(e.key === 'j' ? 1 : -1); return; }
  if (e.key === 'j' || e.key === 'k') { e.preventDefault(); stepQueue(e.key === 'j' ? 1 : -1); return; }
  if (e.key === '[') { e.preventDefault(); toggleQueue(); return; }
  if (e.key === 'f') { e.preventDefault(); toggleFocus(); return; }
  if (e.key === 'e' && tab === 'orch' && currentOrch()) { e.preventDefault(); orchUi.compose = true; orchUi.focusCompose = true; renderOrchestration(true); return; }
  if (e.key === 'd' && currentWt()) { e.preventDefault(); headOpen = !headOpen; localSet('headOpen', headOpen ? '1' : '0'); renderPanel(); return; }
  if (e.key === 'a') {
    const path = panelOpen ? selected : null;
    const wt = state.worktrees.find((w) => w.path === path);
    const s = wt && liveSession(wt);
    if (s?.status === 'needs_input') { post('/api/keys', { target: s.sessionId, ops: [keysOf(s).allow] }).then(() => { toast(`Permission accordée à ${wt.name}.`); setTimeout(refresh, 800); }); }
    return;
  }
  if (/^[1-9]$/.test(e.key) && panelOpen) { document.querySelectorAll('#tabs button')[Number(e.key) - 1]?.click(); return; }
  if (e.key === 'l' && panelOpen && currentSession()) { e.preventDefault(); openReaderFor(currentSession().sessionId, currentWt()?.name); return; }
  if (e.key === 'n') { e.preventDefault(); openNewSession(); return; }
  if (e.key === 'H' || e.key === 'h') { e.preventDefault(); openHistory(); return; }
  if (e.key === 's') { e.preventDefault(); openSkills(); return; }
  if (e.key === '?') { $('help-dialog').showModal(); }
});
