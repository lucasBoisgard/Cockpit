async function openPrDialog(wtPath) {
  const res = await api(`/api/pr-draft?wt=${encodeURIComponent(wtPath)}`).catch(() => null);
  if (!res?.ok) { toast('Impossible de préparer la PR.', 'error'); return; }
  const draft = await res.json();
  $('pr-form').dataset.path = wtPath;
  $('pr-title').value = draft.title;
  $('pr-body').value = draft.body;
  $('pr-labels').value = draft.labels.join(', ');
  $('pr-assignee').value = draft.assignee;
  $('pr-draft').checked = false;
  $('pr-info').textContent = `⎇ ${draft.branch} → ${draft.base} · ${draft.commits.length} commit${draft.commits.length > 1 ? 's' : ''} : ${draft.commits.slice(0, 5).join(' · ')}${draft.commits.length > 5 ? '…' : ''}`;
  $('pr-dialog').showModal();
  $('pr-title').focus();
}

async function pushCommits(wtPath) {
  const wt = state.worktrees.find((w) => w.path === wtPath);
  if (!wt || !confirm(`Pousser ${wt.ahead} commit${wt.ahead > 1 ? 's' : ''} de ⎇ ${wt.branch} sur origin ?`)) return;
  const result = await post('/api/push', { path: wtPath });
  toast(result.ok ? 'Commits poussés.' : result.data.error || 'Push impossible.', result.ok ? '' : 'error');
  refresh();
}

$('pr-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('pr-submit').disabled = true;
  $('pr-submit').textContent = 'Création…';
  const result = await post('/api/pr', {
    path: $('pr-form').dataset.path,
    title: $('pr-title').value,
    body: $('pr-body').value,
    labels: $('pr-labels').value.split(',').map((l) => l.trim()).filter(Boolean),
    assignee: $('pr-assignee').value.trim(),
    draft: $('pr-draft').checked,
  });
  $('pr-submit').disabled = false;
  $('pr-submit').textContent = 'Pousser et créer la PR';
  if (!result.ok) { toast(result.data.error || 'Création impossible.', 'error'); return; }
  $('pr-dialog').close();
  const c = result.data.check;
  const problems = c ? [!c.labels && 'labels manquants', !c.assignee && 'assignee manquant', !c.footer && 'footer « Generated with Claude Code » présent'].filter(Boolean) : [];
  toast(problems.length ? `PR créée, à vérifier : ${problems.join(', ')}` : `PR créée : ${result.data.url}`, problems.length ? 'error' : '', () => window.open(result.data.url, '_blank', 'noopener'));
  refresh();
});
