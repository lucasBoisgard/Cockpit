function renderChatItems(items) {
  return items.map((item) => {
    if (item.kind === 'user') return `<div class="msg user">${escLink(item.text)}</div>`;
    if (item.kind === 'assistant') return `<div class="msg assistant">${md(item.text)}</div>`;
    return `<details class="tool"><summary><b>${esc(item.tool)}</b><span>${escLink(item.detail)}</span></summary>${item.result ? `<pre>${escLink(item.result)}</pre>` : ''}</details>`;
  }).join('');
}

async function searchHistory() {
  const q = $('history-q').value.trim();
  $('history-list').innerHTML = '<div class="placeholder">Recherche…</div>';
  const res = await api(`/api/history?q=${encodeURIComponent(q)}`).catch(() => null);
  const list = res?.ok ? await res.json() : [];
  if ($('history-q').value.trim() !== q) return;
  $('history-list').innerHTML = list.length ? list.map((h) => `<div class="row clickable" data-history="${esc(h.sessionId)}">
      <div class="top-line"><span class="grow">${esc(h.title || '(sans prompt)')}</span><span class="meta-line">${new Date(h.lastAt).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
      <div class="meta-line">${esc(h.worktree)} · ⎇ ${esc(h.branch || '?')} · ${h.messages} messages${h.exists ? '' : ' · dossier supprimé'}${h.files.length ? ` · ${esc(h.files.slice(0, 3).join(', '))}${h.files.length > 3 ? '…' : ''}` : ''}</div>
      ${h.snippet ? `<div class="snippet">… ${esc(h.snippet)} …</div>` : ''}
    </div>`).join('') : '<div class="placeholder">Aucune session trouvée.</div>';
}

async function openHistoryItem(sessionId) {
  const res = await api(`/api/history/chat?session=${encodeURIComponent(sessionId)}`).catch(() => null);
  if (!res?.ok) { toast('Conversation introuvable.', 'error'); return; }
  const chat = await res.json();
  const lastAssistant = [...chat.items].reverse().find((i) => i.kind === 'assistant')?.text || '';
  const title = chat.items.find((i) => i.kind === 'user')?.text || '';
  $('history-list').hidden = true;
  $('history-back').hidden = false;
  $('history-view').hidden = false;
  $('history-view').innerHTML = `<div class="card-actions"><button class="btn primary" data-history-resume="${esc(sessionId)}">Reprendre cette session</button><button class="btn" id="history-context">Nouvelle session avec ce contexte</button></div><div class="history-chat">${renderChatItems(chat.items)}</div>`;
  $('history-context').onclick = () => {
    $('history-dialog').close();
    openNewSession({ prompt: `Reprends le contexte d'une session précédente.\n\nSa demande initiale :\n${title.slice(0, 600)}\n\nSon dernier message :\n${lastAssistant.slice(0, 1500)}\n\nSuite : ` });
  };
}

function openHistory() {
  $('history-list').hidden = false;
  $('history-view').hidden = true;
  $('history-back').hidden = true;
  if (!$('history-dialog').open) $('history-dialog').showModal();
  $('history-q').focus();
  searchHistory();
}

$('history-q').addEventListener('input', () => { clearTimeout(historyTimer); historyTimer = setTimeout(searchHistory, 350); });
$('history-list').addEventListener('click', (e) => { const row = e.target.closest('[data-history]'); if (row) openHistoryItem(row.dataset.history); });
$('history-back').addEventListener('click', () => { $('history-view').hidden = true; $('history-list').hidden = false; $('history-back').hidden = true; });
$('history-view').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-history-resume]');
  if (!b) return;
  b.disabled = true;
  const result = await post('/api/history/resume', { session: b.dataset.historyResume });
  b.disabled = false;
  if (!result.ok) { toast(result.data.error || 'Reprise impossible.', 'error'); return; }
  $('history-dialog').close();
  pendingSelect = result.data.worktree;
  toast(`Session reprise dans tmux (${result.data.worktree}).`);
  setTimeout(refresh, 2500);
});
