const SOURCE_LABEL = { project: 'projet', user: 'perso', synced: 'claude.ai', plugin: 'plugin', builtin: 'intégrée' };
const commandsCache = new Map();
let suggestions = [];
let suggestIndex = 0;

async function loadCommands(wtPath) {
  const cached = commandsCache.get(wtPath);
  if (cached && Date.now() - cached.at < 30000) return cached.list;
  const res = await api(`/api/commands?path=${encodeURIComponent(wtPath)}`);
  const list = res.ok ? await res.json() : [];
  commandsCache.set(wtPath, { at: Date.now(), list });
  return list;
}

function hideSuggest() { suggestions = []; $('suggest').hidden = true; }

function renderSuggest() {
  const box = $('suggest');
  if (!suggestions.length) { box.hidden = true; return; }
  box.innerHTML = suggestions.map((c, i) => `<button type="button" role="option" data-cmd="${i}" class="${i === suggestIndex ? 'on' : ''}" title="${esc(c.description)}"><span class="cmd-name">/${esc(c.name)}</span>${c.hint ? `<span class="cmd-hint">${esc(c.hint)}</span>` : ''}<span class="cmd-desc">${esc(c.description)}</span><span class="cmd-tag">${c.interactive ? 'menu terminal · ' : ''}${SOURCE_LABEL[c.source] || ''}</span></button>`).join('');
  box.hidden = false;
  box.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}

async function updateSuggest() {
  const value = $('composer-input').value;
  const wt = currentWt();
  const match = value.match(/^\/([^\s]*)$/);
  if (!match || !wt) { hideSuggest(); return; }
  const list = await loadCommands(wt.path);
  if ($('composer-input').value !== value) return;
  const query = match[1].toLowerCase();
  const score = (c) => {
    const name = c.name.toLowerCase();
    if (name.startsWith(query)) return 0;
    if (name.split(/[:-]/).some((part) => part.startsWith(query))) return 1;
    if (name.includes(query)) return 2;
    return c.description.toLowerCase().includes(query) ? 3 : -1;
  };
  suggestions = list.map((c) => ({ c, s: score(c) })).filter((x) => x.s >= 0).sort((a, b) => a.s - b.s || a.c.name.localeCompare(b.c.name)).map((x) => x.c).slice(0, 50);
  suggestIndex = 0;
  renderSuggest();
}

function applySuggest(i) {
  const c = suggestions[i];
  if (!c) return;
  const input = $('composer-input');
  input.value = `/${c.name} `;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  hideSuggest();
}

$('composer-input').addEventListener('input', updateSuggest);
$('composer-input').addEventListener('blur', () => setTimeout(hideSuggest, 150));
$('suggest').addEventListener('mousedown', (e) => {
  const b = e.target.closest('[data-cmd]');
  if (b) { e.preventDefault(); applySuggest(Number(b.dataset.cmd)); }
});

$('composer-input').addEventListener('keydown', (e) => {
  if (suggestions.length && !e.isComposing) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      suggestIndex = (suggestIndex + (e.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length;
      renderSuggest();
      return;
    }
    const exact = $('composer-input').value === `/${suggestions[suggestIndex].name}`;
    if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !exact)) { e.preventDefault(); applySuggest(suggestIndex); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideSuggest(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); }
});
