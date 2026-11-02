$('panel').addEventListener('click', async (e) => {
  const t = e.target;
  const dequeueBtn = t.closest('[data-dequeue]');
  if (dequeueBtn) { await post('/api/queue/remove', { target: chatSession, id: dequeueBtn.dataset.dequeue }); refresh(); return; }
  const sinceLink = t.closest('[data-since]');
  if (sinceLink) { since = sinceLink.dataset.since; selectedFile = null; tab = 'changes'; renderTabs(); openChanges(); return; }
  if (t.id === 'restore-btn') {
    if (!confirm('Restaurer les fichiers suivis du worktree dans leur état d’avant ce tour ?\n\nLes modifications faites depuis sur ces fichiers sont perdues. Les nouveaux fichiers non suivis restent en place.')) return;
    const result = await post('/api/restore', { path: selected, sha: since });
    toast(result.ok ? 'Point restauré.' : result.data.error || 'Restauration impossible.', result.ok ? '' : 'error');
    since = null;
    loadSince();
    refresh();
    return;
  }
  const readBtn = t.closest('[data-read]');
  if (readBtn) { openReaderAt(Number(readBtn.dataset.read)); return; }
  const delegateBtn = t.closest('[data-delegate]');
  if (delegateBtn) { delegate(Number(delegateBtn.dataset.delegate)); return; }
  const commentBtn = t.closest('[data-comment]');
  if (commentBtn) { renderDiff(Number(commentBtn.dataset.comment)); return; }
  const saveBtn = t.closest('[data-cm-save]');
  if (saveBtn) { addComment(Number(saveBtn.dataset.cmSave)); return; }
  if (t.closest('[data-cm-cancel]')) { renderDiff(); return; }
  const uncomment = t.closest('[data-uncomment]');
  if (uncomment) { const list = commentsFor(selected); list.splice(Number(uncomment.dataset.uncomment), 1); reviewComments.set(selected, list); renderDiff(); return; }
  if (t.id === 'cm-send') { sendComments(); return; }
  if (t.id === 'cm-clear') { if (confirm('Supprimer les commentaires en attente ?')) { reviewComments.delete(selected); renderDiff(); } return; }
  const fixBtn = t.closest('[data-fixblock]');
  if (fixBtn) {
    const b = reportBlocks[Number(fixBtn.dataset.fixblock)];
    const target = liveSession(currentWt());
    if (!b || !target) { toast('Aucune session pilotable dans ce worktree.', 'error'); return; }
    const text = [`Corrige ce point de la review : ${b.title}${b.file ? ` (${b.file}${b.line ? `:${b.line}` : ''})` : ''}`, b.finding && `Constat : ${b.finding}`, b.fix && `Correctif proposé : ${b.fix}`].filter(Boolean).join('\n\n');
    const result = await post('/api/deliver', { target: target.sessionId, text });
    toast(result.ok ? (result.data.outcome === 'queued' ? 'Demande mise en file.' : 'Demande envoyée à Claude.') : result.data.error || 'Envoi impossible.', result.ok ? '' : 'error');
    return;
  }
  const showDiff = t.closest('[data-showdiff]');
  if (showDiff) {
    const b = reportBlocks[Number(showDiff.dataset.showdiff)];
    const matchIn = (list) => list.find((f) => f.path === b.file || b.file.endsWith(`/${f.path}`) || f.path.endsWith(`/${b.file}`));
    const local = matchIn(currentWt()?.files || []);
    let match = local;
    if (!local) {
      const res = await api(`/api/changes?wt=${encodeURIComponent(selected)}&since=branch`).catch(() => null);
      const branchFiles = res?.ok ? await res.json() : [];
      match = matchIn(branchFiles);
      if (!match) { toast('Ce fichier n’a pas de changement dans ce ticket.', 'error'); return; }
      sinceFiles = branchFiles;
    }
    since = local ? null : 'branch'; selectedFile = match.path; tab = 'changes'; renderTabs(); renderPanel();
    await loadDiff();
    document.querySelector(`#diff .line[data-ln="${Number(b.line)}"]`)?.scrollIntoView({ block: 'center' });
    return;
  }
  const sendCheck = t.closest('[data-sendcheck]');
  if (sendCheck) {
    sendCheck.disabled = true;
    const result = await post('/api/checks/send', { path: selected, check: sendCheck.dataset.sendcheck });
    sendCheck.disabled = false;
    toast(result.ok ? (result.data.outcome === 'queued' ? 'Échec mis en file pour Claude.' : 'Échec envoyé à Claude.') : result.data.error || 'Envoi impossible.', result.ok ? '' : 'error');
    return;
  }
  const prBtn = t.closest('[data-pr]');
  if (prBtn) { openPrDialog(prBtn.dataset.pr); return; }
  const pushBtn = t.closest('[data-push]');
  if (pushBtn) { pushCommits(pushBtn.dataset.push); return; }
  const serveBtn = t.closest('[data-serve]');
  if (serveBtn) { serveApp(serveBtn.dataset.serve); }
});
