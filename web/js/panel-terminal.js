const KEYMAP = { Enter: 'Enter', Escape: 'Escape', Backspace: 'BSpace', Tab: 'Tab', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Delete: 'DC', Home: 'Home', End: 'End', PageUp: 'PPage', PageDown: 'NPage' };
const ANSI16 = ['#2a2e35', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#d6d9de', '#5c6370', '#ff7b86', '#b5e08f', '#f2d48f', '#8cc4ff', '#dda0f0', '#7fd6e0', '#ffffff'];

function color256(n) {
  if (n < 16) return ANSI16[n];
  if (n < 232) { const v = [0, 95, 135, 175, 215, 255]; n -= 16; return `rgb(${v[Math.floor(n / 36)]},${v[Math.floor(n / 6) % 6]},${v[n % 6]})`; }
  const g = 8 + 10 * (n - 232);
  return `rgb(${g},${g},${g})`;
}

function ansiToHtml(text) {
  const clean = text.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '').replace(/\x1b\[[0-9;?]*[A-Za-ln-z]/g, '');
  const re = /\x1b\[([0-9;]*)m/g;
  let st = {};
  let out = '';
  let last = 0;
  let m;
  const flush = (chunk) => {
    if (!chunk) return;
    let fg = st.fg;
    let bg = st.bg;
    if (st.inverse) [fg, bg] = [bg || 'var(--term-bg)', fg || 'var(--term-fg)'];
    const css = [fg && `color:${fg}`, bg && `background:${bg}`, st.bold && 'font-weight:700', st.dim && 'opacity:.6', st.italic && 'font-style:italic', st.underline && 'text-decoration:underline'].filter(Boolean).join(';');
    out += css ? `<span style="${css}">${escLink(chunk)}</span>` : escLink(chunk);
  };
  while ((m = re.exec(clean))) {
    flush(clean.slice(last, m.index));
    last = re.lastIndex;
    const codes = (m[1] || '0').split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i];
      if (c === 0) st = {};
      else if (c === 1) st.bold = true;
      else if (c === 2) st.dim = true;
      else if (c === 3) st.italic = true;
      else if (c === 4) st.underline = true;
      else if (c === 7) st.inverse = true;
      else if (c === 22) { st.bold = false; st.dim = false; }
      else if (c === 23) st.italic = false;
      else if (c === 24) st.underline = false;
      else if (c === 27) st.inverse = false;
      else if (c >= 30 && c <= 37) st.fg = ANSI16[c - 30];
      else if (c === 39) st.fg = null;
      else if (c >= 40 && c <= 47) st.bg = ANSI16[c - 40];
      else if (c === 49) st.bg = null;
      else if (c >= 90 && c <= 97) st.fg = ANSI16[c - 82];
      else if (c >= 100 && c <= 107) st.bg = ANSI16[c - 92];
      else if (c === 38 || c === 48) {
        const key = c === 38 ? 'fg' : 'bg';
        if (codes[i + 1] === 5) { st[key] = color256(codes[i + 2]); i += 2; }
        else if (codes[i + 1] === 2) { st[key] = `rgb(${codes[i + 2]},${codes[i + 3]},${codes[i + 4]})`; i += 4; }
      }
    }
  }
  flush(clean.slice(last));
  return out;
}

const termTarget = () => (tab === 'app' ? APP : selected === SHELL ? SHELL : chatSession);
const termAvailable = () => (tab === 'app' ? !!state?.app?.build : selected === SHELL || !!currentSession()?.live);

async function loadScreen() {
  const box = $(tab === 'app' ? 'app-screen' : 'screen');
  if (!termAvailable() && tab === 'app') { screenKey = ''; box.innerHTML = '<div class="placeholder">Aucun build lancé depuis le cockpit. Les logs de la commande de lancement apparaîtront ici.</div>'; return; }
  if (!termAvailable()) { screenKey = ''; box.innerHTML = '<div class="placeholder">Cette session ne tourne pas dans tmux. Reprends-la depuis l\'onglet Conversation pour obtenir un terminal.</div>'; return; }
  if (screenLoading) return;
  screenLoading = true;
  try {
    const target = termTarget();
    const known = screenKey === `${tab}|${target}` ? screenLast : '';
    const res = await api(`/api/screen?target=${encodeURIComponent(target)}${known ? `&hash=${known}` : ''}`).catch(() => null);
    if (!res || !res.ok || res.status === 204) return;
    renderScreen(box, await res.text(), `${tab}|${target}`, res.headers.get('X-Screen-Hash'));
  } finally {
    screenLoading = false;
  }
}

function renderScreen(box, text, key, hash) {
  screenKey = key;
  screenLast = hash || '';
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = ansiToHtml(text);
  if (nearBottom) box.scrollTop = box.scrollHeight;
}

function queueOp(op) {
  const last = pendingOps[pendingOps.length - 1];
  if (op.literal && last && last.literal) last.literal += op.literal;
  else pendingOps.push(op);
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flushOps, 40);
}

async function flushOps() {
  const ops = pendingOps;
  pendingOps = [];
  if (!ops.length) return;
  const target = termTarget();
  const key = `${tab}|${target}`;
  const result = await post('/api/keys', { target, ops, withScreen: true, hash: screenKey === key ? screenLast : '' });
  if (!result.ok) { toast(result.data.error || 'Envoi impossible.', 'error'); return; }
  if (result.data.screen != null && termTarget() === target) renderScreen($(tab === 'app' ? 'app-screen' : 'screen'), result.data.screen, key, result.data.hash);
  setTimeout(loadScreen, 300);
}

async function sendKey(key) {
  const op = /^\d$/.test(key) ? { literal: key } : { key };
  const result = await post('/api/keys', { target: termTarget(), ops: [op] });
  if (!result.ok) toast(result.data.error || 'Envoi impossible.', 'error');
  setTimeout(loadScreen, 250);
}

$('screen').addEventListener('keydown', (e) => {
  if (e.metaKey || e.key === 'Escape') return;
  let op = null;
  if (e.ctrlKey && /^[a-z]$/i.test(e.key)) op = { key: `C-${e.key.toLowerCase()}` };
  else if (e.key === 'Tab' && e.shiftKey) op = { key: 'BTab' };
  else if (KEYMAP[e.key]) op = { key: KEYMAP[e.key] };
  else if (e.key.length === 1 && !e.ctrlKey && !e.altKey) op = { literal: e.key };
  if (!op) return;
  e.preventDefault();
  e.stopPropagation();
  queueOp(op);
});

$('screen').addEventListener('paste', async (e) => {
  const text = e.clipboardData.getData('text');
  if (!text) return;
  e.preventDefault();
  const result = await post('/api/paste', { target: termTarget(), text });
  if (!result.ok) toast(result.data.error || 'Collage impossible.', 'error');
  setTimeout(loadScreen, 150);
});
