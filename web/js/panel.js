const headEnd = (extra = '') => `<div class="head-end">${extra}${appButton()}<button class="close" id="close" title="Fermer">×</button></div>`;

function renderTabs() {
  const tabs = selected === SHELL ? [['term', 'Terminal']] : selected === USAGE ? [['usage', 'Tokens']] : [['chat', 'Conversation'], ['term', 'Terminal'], ['changes', 'Changements'], ['agents', 'Agents']];
  if (currentWt()?.review) tabs.unshift(['report', 'Rapport']);
  if (currentWt() && !isBase(currentWt()) && state.pr?.enabled) tabs.push(['checks', currentWt().pr ? `PR #${currentWt().pr.number}` : 'PR']);
  if (state.app) tabs.push(['app', `App<span class="tab-dot ${esc(state.app.state)}"></span>`]);
  if (!tabs.some(([id]) => id === tab)) tab = tabs[0][0];
  $('tabs').innerHTML = tabs.map(([id, label]) => `<button data-tab="${id}" class="${id === tab ? 'on' : ''}">${label}</button>`).join('');
  $('report-view').hidden = tab !== 'report';
  $('chat-view').hidden = tab !== 'chat';
  $('agents-view').hidden = tab !== 'agents';
  $('term-view').hidden = tab !== 'term';
  $('changes-view').hidden = tab !== 'changes';
  $('panel').classList.toggle('wide', tab === 'changes' && changesWide);
  $('usage-view').hidden = tab !== 'usage';
  $('app-view').hidden = tab !== 'app';
  $('checks-view').hidden = tab !== 'checks';
}

function renderPanel() {
  const panel = $('panel');
  const wt = currentWt();
  const open = selected === SHELL || selected === USAGE || !!wt;
  panel.classList.toggle('open', open);
  if (!open) return;
  renderTabs();
  $('app-pane').innerHTML = appPane();
  if (selected === SHELL) {
    $('panel-head').innerHTML = `<div><div class="name">Terminal</div><div class="branch">bash · ${esc(state.repo)} · session tmux cw-shell</div></div>${headEnd()}`;
    return;
  }
  if (selected === USAGE) {
    $('panel-head').innerHTML = `<div><div class="name">Tokens</div><div class="branch">limites du compte, sessions et usage des 7 derniers jours</div></div>${headEnd()}`;
    renderUsage();
    return;
  }
  if (!chatSession || !wt.sessions.some((x) => x.sessionId === chatSession)) chatSession = primarySession(wt)?.sessionId || null;
  const st = sessionStatus(wt);
  const s = currentSession();
  $('panel-head').innerHTML = `
    <div><div class="name">${esc(wt.label || wt.name)}</div><div class="branch-row"><span class="repo-chip" title="${esc(wt.repo || 'Repo')}">${esc(wt.repoName || state.repoName)}</span>${branchChip(wt)}${prChip(wt.pr)}<span class="branch">${esc(wt.path)}</span></div>${extChips(wt) ? `<div class="branch-row">${extChips(wt)}</div>` : ''}</div>
    ${headEnd(`<span class="badge ${st}"><span class="dot"></span>${primarySession(wt) ? statusLabel(primarySession(wt), st, STATUS) : STATUS[st].label}</span>`)}`;
  renderReport(wt);
  renderChatBar(wt);
  renderComposer(s);
  updateMode();
  updateSetting('model');
  updateSetting('effort');
  const shown = shownFiles();
  const commits = ticket?.path === changesPath() ? ticket.commits : [];
  const pr = ticket?.path === changesPath() ? ticket.pr : null;
  const repos = cardRepos(wt);
  const option = (value, label) => `<option value="${esc(value)}" ${(since || '') === value ? 'selected' : ''}>${esc(label)}</option>`;
  const repoOption = (value, label) => `<option value="${esc(value)}" ${(changesRepo || '') === value ? 'selected' : ''}>${esc(label)}</option>`;
  const repoBox = repos.length ? `<div class="since-box"><h3>Repo</h3>
      <select id="repo-select" aria-label="Repo des changements">
        ${repoOption('', `${state.repoName || 'Repo de la carte'}${wt.branch ? ` ⎇ ${wt.branch}` : ''}`)}
        ${repos.map((r) => repoOption(r.path, `${r.name}${r.branch ? ` ⎇ ${r.branch}` : ''}`)).join('')}
      </select>
    </div>` : '';
  const scopeBox = commits.length || pr ? `<div class="since-box"><h3>Périmètre</h3>
      <select id="since-select" aria-label="Périmètre des changements">
        ${commits.length ? option('branch', `${!changesRepo && wt.pr?.state === 'OPEN' ? `PR #${wt.pr.number}` : 'Tout le ticket'} · ${commits.length} commit${commits.length > 1 ? 's' : ''} depuis ${ticket.base}`) : ''}
        ${pr ? option('pr', `Pas encore poussé sur ${pr.branch}`) : ''}
        ${option('', 'Non commité')}
        ${commits.length ? `<optgroup label="Un commit">${commits.map((c) => option(`commit:${c.sha}`, `${c.sha.slice(0, 7)} · ${String(c.subject).slice(0, 70)}`)).join('')}</optgroup>` : ''}
      </select>
    </div>` : '';
  const added = shown.reduce((n, f) => n + (f.added || 0), 0);
  const deleted = shown.reduce((n, f) => n + (f.deleted || 0), 0);
  const sum = shown.length ? `<div class="files-sum">${shown.length} fichier${shown.length > 1 ? 's' : ''} · <span class="plus">+${added}</span> <span class="minus">−${deleted}</span></div>` : '';
  setHtml($('side'), `
    ${s?.task ? `<div><h3>Tâche</h3><div class="task" style="-webkit-line-clamp: 8">${esc(s.task)}</div></div>` : ''}
    ${repoBox}
    ${scopeBox}
    <div><h3>${SCOPE_TITLE[scopeKind(since)]}</h3>${sum}</div>`);
  $('file-filter').hidden = shown.length < 2;
  setHtml($('file-tree'), fileTree(shown));
}

function select(target) {
  freshDone.delete(target);
  selected = target; selectedFile = null; chatSession = null; chatSignature = null; chatBarSignature = null; reportSignature = null;
  since = null; sinceFiles = null; changesRepo = null; lastDiffText = ''; checksLoadedAt = 0; ticket = null; fileFilter = ''; collapsedDirs.clear(); $('file-filter').value = '';
  if (target === SHELL && tab !== 'app') tab = 'term';
  if (target === USAGE) tab = 'usage';
  if (currentWt()?.review?.report) tab = 'report';
  renderGrid(); renderPanel();
  if (tab === 'app') loadScreen();
  if (target === USAGE) loadUsage();
  else if (target !== SHELL) { loadDiff(); if (tab === 'chat') loadChat(true); if (tab === 'checks') loadChecks(); if (tab === 'changes') openChanges(); if (tab === 'agents') loadAgents(); }
  if (tab === 'term') { loadScreen(); $('screen').focus(); }
}

function closePanel() { selected = null; selectedFile = null; renderGrid(); renderPanel(); }

$('panel').addEventListener('change', (e) => {
  if (e.target.id === 'mode-select') { setMode(e.target.value); return; }
  if (e.target.id === 'model-select' || e.target.id === 'effort-select') { setSetting(e.target.id.replace('-select', ''), e.target.value); return; }
  if (e.target.id !== 'session-select') return;
  chatSession = e.target.value; chatBarSignature = null;
  renderPanel(); loadChat(true);
  if (tab === 'agents') loadAgents();
});

$('panel').addEventListener('click', async (e) => {
  if (e.target.id === 'close') { closePanel(); return; }
  if (e.target.closest('#app-btn')) {
    if ((state.app?.state || 'stopped') === 'stopped') await appAction('start');
    tab = 'app'; localSet('tab', tab); renderTabs(); loadScreen();
    return;
  }
  const appBtn = e.target.closest('[data-app]');
  if (appBtn) { appAction(appBtn.dataset.app); return; }
  const draftBtn = e.target.closest('[data-draft]');
  if (draftBtn) {
    const ok = await copyText(drafts[Number(draftBtn.dataset.draft)] || '');
    draftBtn.textContent = ok ? 'Copié' : 'Copie impossible';
    setTimeout(() => (draftBtn.textContent = 'Copier'), 1500);
    return;
  }
  if (e.target.id === 'composer-send') { sendMessage(); return; }
  if (e.target.id === 'composer-parallel') { sendParallel(); return; }
  if (e.target.id === 'resume-btn') {
    const result = await post('/api/resume', { session: chatSession });
    toast(result.ok ? 'Session relancée dans tmux. Elle sera pilotable dans quelques secondes.' : result.data.error || 'Reprise impossible.', result.ok ? '' : 'error');
    setTimeout(refresh, 2500);
    return;
  }
  const tabBtn = e.target.closest('#tabs button');
  if (tabBtn) {
    tab = tabBtn.dataset.tab; if (tab !== 'report') localSet('tab', tab); renderTabs();
    if (tab === 'chat') loadChat(true);
    if (tab === 'term') { loadScreen(); $('screen').focus(); }
    if (tab === 'app') loadScreen();
    if (tab === 'changes') openChanges();
    if (tab === 'agents') loadAgents();
    return;
  }
  const goto = e.target.closest('[data-goto]');
  if (goto) { tab = goto.dataset.goto; renderTabs(); loadScreen(); $('screen').focus(); return; }
  const keyBtn = e.target.closest('[data-key]');
  if (keyBtn) { sendKey(keyBtn.dataset.key); return; }
  const f = e.target.closest('.file[data-file]');
  if (f) { selectedFile = f.dataset.file; renderPanel(); loadDiff(); return; }
  const dir = e.target.closest('[data-dir]');
  if (dir) { collapsedDirs.has(dir.dataset.dir) ? collapsedDirs.delete(dir.dataset.dir) : collapsedDirs.add(dir.dataset.dir); renderPanel(); return; }
  const step = e.target.closest('[data-step]');
  if (step) { stepFile(Number(step.dataset.step)); return; }
  if (e.target.closest('[data-copy-path]')) { copyText(selectedFile).then((ok) => toast(ok ? 'Chemin copié.' : 'Copie impossible.', ok ? '' : 'error')); return; }
  if (e.target.closest('[data-wide]')) { changesWide = !changesWide; localSet('changesWide', changesWide ? '1' : '0'); renderTabs(); renderDiff(); }
});
