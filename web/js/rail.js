// Workstation context rail: the changed files and the agents of the open session, folded to icons with ],
// hidden in focus mode (f) together with the queue.
let railMin = localGet('railMin') === '1';
let railTab = localGet('railTab') === 'agents' ? 'agents' : 'files';
let focusMode = false;

const AGENT_WORD = { starting: 'démarre', working: 'travaille', needs: 'attend', done: 'a fini', stopped: 'arrêté' };

function railVisible() {
  return isWorkstation() && !focusMode && !!currentWt() && tab !== 'changes' && tab !== 'agents' && tab !== 'orch';
}

function railFiles(wt) {
  if (!wt.files.length) return '<div class="rail-empty">Aucun changement non commité.</div>';
  const rows = wt.files.map((f) => `<button class="rail-file" data-rail-file="${esc(f.path)}" title="${esc(f.path)}"><span class="rail-path">${esc(f.path)}</span><span class="rail-stat">${f.added ? `<span class="plus">+${f.added}</span>` : ''} ${f.deleted ? `<span class="minus">−${f.deleted}</span>` : ''}</span></button>`).join('');
  return `<div class="rail-title"><span>${wt.files.length} fichier${wt.files.length > 1 ? 's' : ''}</span><button class="rail-link" data-rail-tab="changes">ouvrir</button></div>${rows}`;
}

function railAgents(wt) {
  const orch = orchestrationOf(wt);
  if (orch) {
    const rows = orch.agents.map((a) => `<button class="rail-agent" data-rail-session="${esc(a.sessionId)}" title="${esc(a.action || a.name)}"><span class="rail-agent-dot rail-a-${a.status}"></span><span class="rail-agent-name">${esc(a.id)} · ${esc(a.name)}</span><span class="rail-agent-state">${AGENT_WORD[a.status] || a.status}</span></button>`).join('');
    return `<div class="rail-title"><span>◆ ${orch.counts.total} agent${orch.counts.total > 1 ? 's' : ''} · ${esc(orch.phases[orch.phase] || 'sans plan')}</span></div>${rows || '<div class="rail-empty">Le maître n’a pas encore lancé d’agent.</div>'}`;
  }
  const s = currentSession();
  const running = s?.agentsRunning || 0;
  return `<div class="rail-title"><span>Agents de la session</span><button class="rail-link" data-rail-tab="agents">arbre</button></div>
    <div class="rail-empty">${running ? `${running} agent${running > 1 ? 's' : ''} en arrière-plan.` : 'Aucun agent en cours.'}</div>`;
}

function renderRail() {
  const rail = $('rail');
  const visible = railVisible();
  document.body.classList.toggle('ws-no-rail', !visible);
  document.body.classList.toggle('ws-rail-min', visible && railMin);
  document.body.classList.toggle('ws-focus', isWorkstation() && focusMode);
  if (!visible) { setHtml(rail, ''); return; }
  const wt = currentWt();
  const tabs = [['files', 'Fichiers', '▤', wt.files.length], ['agents', 'Agents', '⚙', orchestrationOf(wt)?.counts.total || currentSession()?.agentsRunning || 0]];
  if (railMin) {
    setHtml(rail, `<button class="rail-fold" data-rail-fold title="Déplier le rail (])" aria-label="Déplier le rail">«</button>${tabs.map(([id, label, icon, n]) => `<button class="rail-icon" data-rail-open="${id}" title="${label}">${icon}${n ? `<span class="rail-badge">${n}</span>` : ''}</button>`).join('')}`);
    return;
  }
  const scroll = rail.querySelector('.rail-body')?.scrollTop || 0;
  setHtml(rail, `<div class="rail-head">${tabs.map(([id, label, , n]) => `<button class="rail-tab" data-rail-pick="${id}" aria-selected="${railTab === id}">${label}${n ? ` <span class="rail-n">${n}</span>` : ''}</button>`).join('')}<button class="rail-fold" data-rail-fold title="Replier le rail (])" aria-label="Replier le rail">»</button></div>
    <div class="rail-body">${railTab === 'files' ? railFiles(wt) : railAgents(wt)}</div>`);
  const body = rail.querySelector('.rail-body');
  if (body) body.scrollTop = scroll;
}

function toggleRail() {
  railMin = !railMin;
  localSet('railMin', railMin ? '1' : '0');
  renderRail();
}

function toggleFocus() {
  focusMode = !focusMode;
  renderRail();
  toast(focusMode ? 'Mode focus : f pour revenir.' : 'Mode focus désactivé.');
}

$('rail').addEventListener('click', async (e) => {
  if (e.target.closest('[data-rail-fold]')) { toggleRail(); return; }
  const open = e.target.closest('[data-rail-open]');
  if (open) { railTab = open.dataset.railOpen; localSet('railTab', railTab); railMin = false; localSet('railMin', '0'); renderRail(); return; }
  const pick = e.target.closest('[data-rail-pick]');
  if (pick) { railTab = pick.dataset.railPick; localSet('railTab', railTab); renderRail(); return; }
  const tabBtn = e.target.closest('[data-rail-tab]');
  if (tabBtn) { document.querySelector(`#tabs [data-tab="${tabBtn.dataset.railTab}"]`)?.click(); return; }
  const file = e.target.closest('[data-rail-file]');
  if (file) {
    resetChanges();
    tab = 'changes'; renderTabs(); renderPanel();
    await openChanges();
    selectedFile = file.dataset.railFile; renderPanel(); loadDiff();
    return;
  }
  const session = e.target.closest('[data-rail-session]');
  if (session) {
    const wt = state.worktrees.find((w) => w.sessions.some((s) => s.sessionId === session.dataset.railSession));
    if (!wt) { toast('Cet agent n’a pas encore de session suivie.'); return; }
    if (wt.path !== selected) select(wt.path);
    tab = 'chat'; renderTabs(); chatSession = session.dataset.railSession; chatBarSignature = null; renderPanel(); loadChat(true);
  }
});
