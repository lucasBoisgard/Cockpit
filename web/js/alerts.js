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
const NOTE_TEXT = { done: 'a fini', needs_input: 'attend ta réponse', permission: 'demande une permission', question: 'te pose une question' };

function note(e, open) {
  const el = document.createElement('div');
  const group = EVENT_GROUPS.input.includes(e.type) ? 'input' : EVENT_GROUPS.error.includes(e.type) ? 'error' : 'done';
  el.className = `alert-pill ${group}`;
  el.title = e.message || '';
  el.innerHTML = `<span class="dot"></span><b>${esc(e.worktree || 'Cockpit')}</b><span>${esc(NOTE_TEXT[e.type] || EVENT_LABEL[e.type] || e.type)}</span><button aria-label="Fermer">×</button>`;
  const close = () => el.remove();
  el.onclick = (ev) => { close(); if (!ev.target.closest('button')) open(); };
  $('notes').prepend(el);
  while ($('notes').children.length > 4) $('notes').lastElementChild.remove();
  setTimeout(close, group === 'done' ? 8000 : 15000);
}

const EVENT_LABEL = { needs_input: 'Attend', permission: 'Permission', question: 'Question', done: 'Terminé', ci_failed: 'CI en échec', app_ko: 'App KO', merged: 'Mergée', automation: 'Automatisation', automation_failed: 'Automatisation KO', migrations: 'Migrations', migrations_failed: 'Migrations KO' };
const EVENT_GROUPS = { input: ['needs_input', 'permission', 'question'], done: ['done', 'automation', 'merged', 'migrations'], error: ['ci_failed', 'app_ko', 'automation_failed', 'migrations_failed'] };

function updateTitle() {
  const needs = state.worktrees.filter((w) => sessionStatus(w) === 'needs_input').length;
  const working = state.worktrees.filter((w) => sessionStatus(w) === 'working').length;
  document.title = `${needs ? `(${needs}) ` : ''}Worktrees`;
  const color = needs ? '#e0a020' : working ? '#2f6fec' : '#8b929c';
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

function openEvent(e) {
  post('/api/events/read', { ids: [e.id] });
  const wt = state.worktrees.find((w) => w.path === e.path || w.name === e.worktree);
  if (!wt) return;
  select(wt.path);
  if (e.sessionId && wt.sessions.some((s) => s.sessionId === e.sessionId)) { chatSession = e.sessionId; chatBarSignature = null; renderPanel(); loadChat(true); }
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
    const open = () => openEvent(e);
    note(e, open);
    if (e.type === 'done' && e.path && e.path !== selected) freshDone.add(e.path);
  }
}
