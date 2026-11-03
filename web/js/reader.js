let reader = null;

function openReader(list, pos, title) {
  if (!list.length) { toast('Aucune réponse de Claude à lire.', 'error'); return; }
  reader = { list, pos: Math.max(0, Math.min(pos, list.length - 1)), title };
  renderReader();
  if (!$('reader-dialog').open) $('reader-dialog').showModal();
  $('reader-scroll').focus({ preventScroll: true });
  readerToTop();
  requestAnimationFrame(readerToTop);
}

function readerToTop() {
  const box = $('reader-scroll');
  box.style.scrollBehavior = 'auto';
  box.scrollTop = 0;
  box.style.scrollBehavior = '';
  spyReader();
}

function assistantList(items) {
  return items.map((item, index) => ({ ...item, index })).filter((item) => item.kind === 'assistant' && item.text?.trim());
}

function openReaderAt(index) {
  const list = assistantList(chatItems);
  const pos = list.findIndex((item) => item.index === index);
  openReader(list, pos < 0 ? list.length - 1 : pos, currentWt()?.name || '');
}

async function openReaderFor(sessionId, title) {
  const res = await api(`/api/chat?session=${encodeURIComponent(sessionId)}`).catch(() => null);
  if (!res?.ok) { toast('Conversation introuvable.', 'error'); return; }
  const list = assistantList((await res.json()).items);
  openReader(list, list.length - 1, title);
}

function renderReader() {
  const item = reader.list[reader.pos];
  const toc = [];
  $('reader-doc').innerHTML = richMd(item.text, toc);
  const entries = toc.filter((h) => h.level <= 3);
  $('reader-toc').innerHTML = entries.length > 1 ? `<div class="toc-title">Sommaire</div>${entries.map((h) => `<a href="#${h.id}" data-toc="${h.id}" class="l${h.level}">${esc(h.text)}</a>`).join('')}` : '';
  $('reader-body').classList.toggle('no-toc', entries.length < 2);
  $('reader-toc').hidden = entries.length < 2;
  const words = item.text.split(/\s+/).filter(Boolean).length;
  const at = item.at ? new Date(item.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  $('reader-title').textContent = reader.title ? `Claude · ${reader.title}` : 'Claude';
  $('reader-meta').textContent = [at, `${words} mots`, `${Math.max(1, Math.round(words / 230))} min de lecture`].filter(Boolean).join(' · ');
  $('reader-pos').textContent = `${reader.pos + 1} / ${reader.list.length}`;
  document.querySelector('[data-reader-step="-1"]').disabled = reader.pos === 0;
  document.querySelector('[data-reader-step="1"]').disabled = reader.pos === reader.list.length - 1;
  readerToTop();
}

function stepReader(delta) {
  if (!reader) return;
  const pos = reader.pos + delta;
  if (pos < 0 || pos >= reader.list.length) return;
  reader.pos = pos;
  renderReader();
}

function spyReader() {
  const links = [...$('reader-toc').querySelectorAll('[data-toc]')];
  if (!links.length) return;
  const top = $('reader-scroll').getBoundingClientRect().top + 40;
  let current = links[0].dataset.toc;
  for (const link of links) if ($(link.dataset.toc).getBoundingClientRect().top <= top) current = link.dataset.toc;
  for (const link of links) link.classList.toggle('on', link.dataset.toc === current);
}

$('reader-dialog').addEventListener('click', async (e) => {
  if (e.target === $('reader-dialog')) { $('reader-dialog').close(); return; }
  const step = e.target.closest('[data-reader-step]');
  if (step) { stepReader(Number(step.dataset.readerStep)); return; }
  const toc = e.target.closest('[data-toc]');
  if (toc) { e.preventDefault(); $(toc.dataset.toc).scrollIntoView({ block: 'start' }); return; }
  const code = e.target.closest('[data-copy-code]');
  if (code) { const ok = await copyText(code.parentElement.querySelector('code').textContent); code.textContent = ok ? 'Copié' : 'Échec'; setTimeout(() => (code.textContent = 'Copier'), 1500); return; }
  if (e.target.closest('#reader-copy')) { const ok = await copyText(reader.list[reader.pos].text); toast(ok ? 'Markdown copié.' : 'Copie impossible.', ok ? '' : 'error'); }
});
$('reader-dialog').addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'j' || e.key === 'ArrowRight') { e.preventDefault(); stepReader(1); }
  else if (e.key === 'k' || e.key === 'ArrowLeft') { e.preventDefault(); stepReader(-1); }
});
$('reader-scroll').addEventListener('scroll', spyReader, { passive: true });
