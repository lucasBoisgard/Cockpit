// Workstation session header: one line (name, state, why, the actions that state calls for), an expander
// for the details the cards used to show, and a ⋯ menu with every worktree action.
let sessionMenuOpen = false;

const HEAD_STATE = { needs: 'À toi', review: 'À relire', working: 'En cours', read: 'Lu', idle: 'Au repos' };

function headActions(wt, s, st) {
  const orch = orchestrationOf(wt);
  const pause = orch ? `<button class="btn shead-btn" data-head-pause="${orch.paused ? '0' : '1'}" data-master="${esc(orch.masterSessionId)}">${orch.paused ? 'Reprendre' : 'Pause'}</button>` : '';
  return headStateActions(wt, s, st) + pause;
}

function headStateActions(wt, s, st) {
  if (!s) return '';
  const id = esc(s.sessionId);
  const key = (k, label, cls = '') => `<button class="btn shead-btn ${cls}" data-head-op="${esc(JSON.stringify(typeof k === 'object' ? k : { literal: String(k) }))}" data-session="${id}">${label}</button>`;
  const keys = keysOf(s);
  if (st === 'needs_input' && s.live) {
    if (s.provider === 'codex') return '<button class="btn shead-btn shead-main" data-head-ask>Répondre</button>';
    if (s.ask || s.codexScreen) return '<button class="btn shead-btn shead-main" data-head-ask>Répondre</button>';
    if (s.question?.options?.length) return s.question.options.slice(0, 4).map((o, i) => key(i + 1, `${i + 1}. ${esc(oneLineText(o, 40))}`, i ? '' : 'shead-main')).join('');
    if (s.permission) return `${key(keys.allow, 'Autoriser <kbd>a</kbd>', 'shead-main')}${key(keys.always, 'Toujours')}${key(keys.deny, 'Refuser')}`;
    return '<button class="btn shead-btn shead-main" data-head-tab="chat">Répondre</button>';
  }
  if (st === 'working' && s.live && !backgroundOnly(s)) return `<button class="btn shead-btn" data-head-interrupt="${id}">Interrompre</button>`;
  if (st === 'done') {
    const review = wt.files.length || wt.ahead ? `<button class="btn shead-btn shead-review" data-head-tab="changes">Relire</button>` : '';
    return `${review}<button class="btn shead-btn" data-head-read="${id}">Lire <kbd>l</kbd></button>`;
  }
  return '';
}

function headMenu(wt, s) {
  const items = [];
  const item = (attrs, label, sub = '', cls = '') => items.push(`<button class="shead-item ${cls}" ${attrs}><span>${label}${sub ? `<small>${sub}</small>` : ''}</span></button>`);
  if (!isBase(wt) && state.pr?.enabled) {
    if (wt.pr?.state === 'OPEN' && wt.ahead) item(`data-push="${esc(wt.path)}"`, `Pousser ${wt.ahead} commit${wt.ahead > 1 ? 's' : ''}`, 'sans add ni commit');
    else if (wt.pr?.state !== 'OPEN' && wt.pr?.state !== 'MERGED' && (wt.ahead || !wt.upstream) && wt.lastCommit) item(`data-pr="${esc(wt.path)}"`, 'Pousser et ouvrir la PR');
    if (wt.pr) item('data-head-tab="checks"', `PR #${wt.pr.number}`, 'checks, reviews, CI');
  }
  if (s) item(`data-head-read="${esc(s.sessionId)}"`, 'Lire la dernière réponse', '', '');
  if (s) item(`data-head-delegate="${esc(s.sessionId)}"`, 'Déléguer une sous-tâche', 'nouvelle session liée à celle-ci');
  item(`data-head-pin="${esc(wt.path)}"`, pins.has(wt.path) ? 'Désépingler' : 'Épingler en tête de file');
  if (state.app && canServe(wt) && wt.headSha && state.app?.serving?.name !== wt.name) item(`data-serve="${esc(wt.path)}"`, 'Servir l’app depuis ce worktree', 'checkout du dernier commit');
  if (s?.live && !orchestrationOf(wt)) item(`data-head-promote="${esc(s.sessionId)}"`, 'Passer en mode maître', 'la session orchestre des agents');
  item('data-head-history', 'Historique des sessions');
  if (!wt.mainCheckout && !wt.locked) {
    items.push('<hr>');
    item(`data-head-archive="${esc(wt.path)}"`, 'Archiver', 'garde la branche et la conversation');
    item(`data-head-close="${esc(wt.path)}"`, 'Fermer le worktree', '', 'shead-danger');
  }
  return `<div class="shead-menu" role="menu">${items.join('')}</div>`;
}

function sessionHead(wt, st) {
  const s = primarySession(wt);
  const group = queueGroupOf(st, turnRead(wt));
  const orch = orchestrationOf(wt);
  const why = queueReason(wt, s, st);
  const age = s ? statusAge(s, st) : '';
  const details = [
    s?.task ? `<div class="shead-task" title="${esc(s.task)}">${esc(oneLineText(s.task, 400))}</div>` : '',
    `<div class="shead-chips">${wt.otherRepo ? `<span class="repo-chip">${esc(wt.repoName)}</span>` : ''}${branchChip(wt)}${prChip(wt.pr)}${extChips(wt)}${orch ? `<span class="chip shead-orch">◆ maître · ${orch.counts.total} agent${orch.counts.total > 1 ? 's' : ''}</span>${orch.settings.arena ? '<span class="chip shead-arena">Arène</span>' : ''}` : ''}${cardMeta(wt, s, st).join('')}</div>`,
    parallelRow(wt),
  ].join('');
  return `<div class="shead shead-${group}">
    <div class="shead-row">
      ${orch ? '<span class="shead-master" title="Maître orchestrateur">◆</span>' : ''}
      <h2 class="shead-name" title="${esc(wt.path)}">${esc(wt.label || wt.name)}</h2>
      ${isGpt(s) ? `<span class="shead-gpt" title="Session Codex">GPT${s.model ? ` · ${esc(s.model)}` : ''}</span>` : ''}
      <span class="shead-state shead-state-${group}"><span class="shead-dot"></span>${HEAD_STATE[group]}${age ? ` · ${esc(age)}` : ''}</span>
      <span class="shead-why" title="${esc(why)}">${esc(oneLineText(why, 220))}</span>
      <span class="shead-actions">${headActions(wt, s, st)}</span>
      ${appButton()}
      <button class="shead-icon" data-head-toggle aria-expanded="${headOpen}" title="${headOpen ? 'Masquer' : 'Afficher'} les détails (d)">${headOpen ? '⌃' : '⌄'}</button>
      <span class="shead-more"><button class="shead-icon" data-head-menu aria-expanded="${sessionMenuOpen}" aria-label="Actions du worktree">⋯</button>${sessionMenuOpen ? headMenu(wt, s) : ''}</span>
    </div>
    ${headOpen ? `<div class="shead-details">${details}</div>` : ''}
  </div>`;
}

async function headKey(sessionId, ops, done) {
  const result = await post('/api/keys', { target: sessionId, ops });
  toast(result.ok ? done : result.data.error || 'Envoi impossible.', result.ok ? '' : 'error');
  setTimeout(refresh, 800);
}

$('panel-head').addEventListener('click', (e) => {
  const t = e.target;
  const closeMenu = () => { sessionMenuOpen = false; };
  if (t.closest('[data-head-menu]')) { sessionMenuOpen = !sessionMenuOpen; renderPanel(); return; }
  if (t.closest('[data-head-toggle]')) { headOpen = !headOpen; localSet('headOpen', headOpen ? '1' : '0'); renderPanel(); return; }
  if (t.closest('[data-head-ask]')) {
    closeMenu();
    document.querySelector('#tabs [data-tab="chat"]')?.click();
    setTimeout(() => { $('ask-card').scrollIntoView({ block: 'nearest' }); $('ask-card').querySelector('.ask-option, .ask-other')?.focus(); }, 50);
    return;
  }
  const k = t.closest('[data-head-op]');
  if (k) { headKey(k.dataset.session, [JSON.parse(k.dataset.headOp)], 'Réponse envoyée.'); return; }
  const stop = t.closest('[data-head-interrupt]');
  if (stop) { headKey(stop.dataset.headInterrupt, [{ key: 'Escape' }], 'Interruption envoyée.'); return; }
  const tabBtn = t.closest('[data-head-tab]');
  if (tabBtn) { closeMenu(); document.querySelector(`#tabs [data-tab="${tabBtn.dataset.headTab}"]`)?.click(); if (tabBtn.dataset.headTab === 'chat') $('composer-input').focus(); return; }
  const read = t.closest('[data-head-read]');
  if (read) { closeMenu(); renderPanel(); openReaderFor(read.dataset.headRead, currentWt()?.name); return; }
  const delegateBtn = t.closest('[data-head-delegate]');
  if (delegateBtn) { closeMenu(); renderPanel(); openNewSession({ parent: currentWt()?.sessions.find((x) => x.sessionId === delegateBtn.dataset.headDelegate) || null }); return; }
  const pin = t.closest('[data-head-pin]');
  if (pin) { closeMenu(); pins.has(pin.dataset.headPin) ? pins.delete(pin.dataset.headPin) : pins.add(pin.dataset.headPin); localSet('pins', JSON.stringify([...pins])); renderBoard(); renderPanel(); return; }
  const pause = t.closest('[data-head-pause]');
  if (pause) { post('/api/orch/pause', { master: pause.dataset.master, paused: pause.dataset.headPause === '1' }).then((r) => { toast(r.ok ? (pause.dataset.headPause === '1' ? 'Maître en pause.' : 'Maître relancé.') : r.data.error || 'Action impossible.', r.ok ? '' : 'error'); setTimeout(refresh, 500); }); return; }
  const promote = t.closest('[data-head-promote]');
  if (promote) {
    closeMenu(); renderPanel();
    if (!confirm('Passer cette session en mode maître ? Elle recevra les consignes d’orchestrateur et pourra lancer des agents (6 au maximum).')) return;
    post('/api/orch/promote', { sessionId: promote.dataset.headPromote }).then((r) => { toast(r.ok ? 'La session devient maître.' : r.data.error || 'Action impossible.', r.ok ? '' : 'error'); setTimeout(refresh, 500); });
    return;
  }
  if (t.closest('[data-head-history]')) { closeMenu(); renderPanel(); openHistory(); return; }
  const archiveBtn = t.closest('[data-head-archive]');
  if (archiveBtn) { closeMenu(); renderPanel(); archive(archiveBtn.dataset.headArchive); return; }
  const closeBtn = t.closest('[data-head-close]');
  if (closeBtn) { closeMenu(); renderPanel(); openClose(closeBtn.dataset.headClose); return; }
  const openSession = t.closest('[data-open-session]');
  if (openSession) { tab = 'chat'; renderTabs(); chatSession = openSession.dataset.openSession; chatBarSignature = null; renderPanel(); loadChat(true); return; }
  if (t.closest('[data-push], [data-pr], [data-serve]')) { closeMenu(); setTimeout(renderPanel, 0); }
});

document.addEventListener('click', (e) => {
  if (sessionMenuOpen && !e.target.closest('.shead-more')) { sessionMenuOpen = false; renderPanel(); }
});
