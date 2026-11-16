function toast(message, kind, action) {
  const el = document.createElement('div');
  el.className = `alert-pill toast-note ${kind === 'error' ? 'error' : ''}`;
  el.innerHTML = `${kind === 'error' ? '<span class="dot"></span>' : ''}<span>${esc(message)}</span><button aria-label="Fermer">×</button>`;
  const close = () => el.remove();
  el.onclick = (ev) => { close(); if (action && !ev.target.closest('button')) action(); };
  $('notes').querySelector('.toast-note')?.remove();
  $('notes').prepend(el);
  setTimeout(close, kind === 'error' || action ? 6000 : 3500);
}

const freshDone = new Set();
function updateTitle() {
  const needs = state.worktrees.filter((w) => sessionStatus(w) === 'needs_input').length;
  const working = state.worktrees.filter((w) => sessionStatus(w) === 'working').length;
  document.title = `${needs ? `(${needs}) ` : ''}Worktrees`;
  const color = needs ? '#d4852f' : working ? '#5b7fb5' : '#8c847a';
  if (color === faviconColor) return;
  faviconColor = color;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const g = canvas.getContext('2d');
  g.fillStyle = color;
  g.beginPath();
  g.arc(16, 16, 13, 0, Math.PI * 2);
  g.fill();
  let link = document.querySelector('link[rel="icon"]');
  if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
  link.href = canvas.toDataURL();
}

async function loadEvents() {
  const res = await api('/api/events').catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json();
  return data;
}

async function checkEvents() {
  if (!eventsBootstrapped) {
    eventsBootstrapped = true;
    if (!lastSeenEvent || lastSeenEvent > state.lastEventId) { lastSeenEvent = state.lastEventId; localSet('lastSeenEvent', String(lastSeenEvent)); return; }
  }
  if (state.lastEventId <= lastSeenEvent) return;
  const data = await loadEvents();
  if (!data) return;
  const fresh = data.events.filter((e) => e.id > lastSeenEvent).reverse();
  lastSeenEvent = data.seq;
  localSet('lastSeenEvent', String(lastSeenEvent));
  for (const e of fresh.slice(-3)) {
    if (e.type === 'done' && e.path && e.path !== selected) freshDone.add(e.path);
  }
}
