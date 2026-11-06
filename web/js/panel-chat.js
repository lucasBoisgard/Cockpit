function renderChatBar(wt) {
  const chip = branchChip(wt);
  const listed = wt.sessions.filter((s) => s.sessionId === chatSession || shownSessions(wt).includes(s));
  const picker = sessionPicker(listed, state.orchestrations, chatSession, chatAgentsOpen);
  const orch = orchestrationOfSession(chatSession, state.orchestrations);
  const signature = `${wt.path}|${listed.map((s) => `${s.sessionId}:${s.live}:${s.status}`).join(',')}|${chatSession}|${chatAgentsOpen}|${orch?.masterSessionId || ''}|${finishedSessionCount(wt)}|${finishedUi.show}|${chip}|${prChip(wt.pr)}|${extChips(wt)}`;
  if (signature === chatBarSignature || document.activeElement?.id === 'session-select') return;
  chatBarSignature = signature;
  const onBranch = `<span class="on-branch">Sur <span class="repo-chip">${esc(state.repoName)}</span>${chip}${prChip(wt.pr)}${extChips(wt)}</span>`;
  if (!wt.sessions.length) { $('chat-bar').innerHTML = `${onBranch} · Aucune session suivie pour ce worktree.`; return; }
  const option = (s) => `<option value="${esc(s.sessionId)}" ${s.sessionId === chatSession ? 'selected' : ''}>${s.live ? '⌨ ' : ''}${s.live && (s.status === 'working' || backgroundOnly(s)) ? '● ' : ''}${s.live && s.status === 'needs_input' ? '❓ ' : ''}${esc((s.lastPrompt || s.task || 'Session sans prompt').slice(0, 70))} · ${ago(s.updatedAt)}</option>`;
  const options = picker.peers.map(option).join('') + (picker.shownAgents.length ? `<optgroup label="Agents">${picker.shownAgents.map(option).join('')}</optgroup>` : '');
  $('chat-bar').innerHTML = `${onBranch}${masterButton(orch)}<label for="session-select">Session</label><select id="session-select">${options}</select>${agentsToggle(picker)}${finishedSessionCount(wt) ? `<button class="btn" data-finished-toggle>${finishedUi.show ? 'Masquer les terminés' : `+ ${finishedSessionCount(wt)} terminé${finishedSessionCount(wt) > 1 ? 's' : ''}`}</button>` : ''}`;
}

function renderComposer(s) {
  const live = !!s?.live;
  renderComposerTarget(s);
  $('composer-input').disabled = !live;
  $('composer-send').disabled = !live;
  $('queue-list').innerHTML = (s?.queue || []).map((q) => `<div class="queue-item"><span title="${esc(q.text)}">⏳ En file : ${esc(q.text)}</span><button data-dequeue="${esc(q.id)}" title="Retirer de la file">✕</button></div>`).join('');
  const parallel = currentWt() ? liveSessions(currentWt()).length : 0;
  if (live && parallel > 1) $('composer-note').textContent = `${parallel} sessions Claude travaillent dans ce worktree : évite qu'elles modifient les mêmes fichiers.`;
  else if (live) $('composer-note').innerHTML = '';
  else if (s) $('composer-note').innerHTML = `Cette session ne tourne pas dans tmux : lecture seule. <button class="btn" id="resume-btn">Reprendre dans le cockpit</button>`;
  else $('composer-note').innerHTML = 'Lance une session avec « Nouvelle session » pour écrire à Claude depuis ici.';
}

let modeBusy = false;

function modeFromScreen(text) {
  const tail = text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').split('\n').slice(-8).join('\n').toLowerCase();
  if (tail.includes('auto mode on')) return 'auto';
  if (tail.includes('accept edits on')) return 'acceptEdits';
  if (tail.includes('plan mode on')) return 'plan';
  if (tail.includes('bypass permissions on')) return 'bypass';
  return 'default';
}

async function readMode(target) {
  const res = await api(`/api/screen?target=${encodeURIComponent(target)}`).catch(() => null);
  if (!res || !res.ok) return null;
  return modeFromScreen(await res.text());
}

async function updateMode() {
  const s = currentSession();
  $('mode-box').hidden = !s?.live || isGpt(s);
  if (!s?.live || isGpt(s) || modeBusy) return;
  const mode = await readMode(s.sessionId);
  if (mode && !modeBusy) $('mode-select').value = mode;
}

async function setMode(target) {
  const s = currentSession();
  if (!s?.live) return;
  modeBusy = true;
  $('mode-select').disabled = true;
  for (let i = 0; i < 6; i++) {
    if ((await readMode(s.sessionId)) === target) break;
    await post('/api/keys', { target: s.sessionId, ops: [{ key: 'BTab' }] });
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  const final = await readMode(s.sessionId);
  $('mode-select').value = final || target;
  $('mode-select').disabled = false;
  modeBusy = false;
  if (final !== target) toast("Ce mode n'est pas accessible avec Maj+Tab dans cette session.", 'error');
}

const SETTINGS = {
  model: { options: MODELS, choice: modelChoice, command: 'model', name: 'modèle', done: 'Modèle changé.', raw: (u) => u?.model || u?.modelId, visible: () => true, label: (u, id) => (u?.model && modelOption(u.modelId, u.model) === id ? u.model : null) },
  effort: { options: EFFORTS, choice: effortChoice, command: 'effort', name: "niveau d'effort", done: "Niveau d'effort changé.", raw: (u) => u?.effort, visible: (u, pending) => !!(u?.effort || pending), label: () => null },
};
const settingPending = { model: new Map(), effort: new Map() };

function updateSetting(key) {
  const s = currentSession();
  const setting = SETTINGS[key];
  const pending = s && settingPending[key].get(s.sessionId);
  $(`${key}-box`).hidden = !s?.live || isGpt(s) || !setting.visible(s.usage, pending);
  if ($(`${key}-box`).hidden) return;
  const current = setting.choice(s.usage, pending, Date.now());
  const extra = current.startsWith('other:') ? [[current, setting.raw(s.usage)]] : current ? [] : [['', 'Inconnu']];
  setHtml($(`${key}-select`), [...setting.options, ...extra].map(([id, name]) => `<option value="${esc(id)}" ${id === '' || id.startsWith('other:') ? 'disabled' : ''}>${esc((id === current && setting.label(s.usage, id)) || name)}</option>`).join(''));
  $(`${key}-select`).value = current;
}

async function setSetting(key, value) {
  const s = currentSession();
  const setting = SETTINGS[key];
  if (!s?.live) return;
  const queue = s.status === 'working';
  const result = await post(queue ? '/api/queue' : '/api/send', { target: s.sessionId, text: `/${setting.command} ${value}` });
  if (!result.ok) { toast(result.data.error || `Changement de ${setting.name} impossible.`, 'error'); updateSetting(key); return; }
  settingPending[key].set(s.sessionId, { value, queued: queue, at: Date.now() });
  updateSetting(key);
  toast(queue ? `Changement de ${setting.name} mis en file : il part à la fin du tour.` : setting.done);
}

function seenAgentTurns(sessionId) {
  try { return Number(localStorage.getItem(`chat-agents-seen:${sessionId}`)) || 0; } catch { return 0; }
}

function markAgentTurnsSeen(sessionId, count) {
  try { localStorage.setItem(`chat-agents-seen:${sessionId}`, String(count)); } catch {}
}

function renderChatLanes(chat) {
  const bar = $('chat-lanes');
  const hasAgents = chat.totals?.agents > 0;
  bar.hidden = !hasAgents;
  if (!hasAgents) return;
  const turns = chat.agentTurns;
  if (chatLane === 'agents') markAgentTurnsSeen(chatSession, turns);
  const unread = chatLane === 'agents' ? 0 : Math.max(0, turns - seenAgentTurns(chatSession));
  bar.innerHTML = `<button class="btn ${chatLane === 'conversation' ? 'on' : ''}" data-lane="conversation">Conversation</button><button class="btn ${chatLane === 'agents' ? 'on' : ''}" data-lane="agents">Agents${unread ? ` <span class="lane-badge">${unread > 99 ? '99+' : unread}</span>` : ''}</button>`;
}

document.addEventListener('click', (e) => {
  const button = e.target.closest('[data-lane]');
  if (!button || chatLane === button.dataset.lane) return;
  chatLane = button.dataset.lane;
  loadChat(true);
});

async function loadChat(force) {
  const box = $('chat');
  if (String(chatSession || '').startsWith('codex-screen:')) {
    setHtml(box, '<div class="placeholder">Cette session GPT n’a pas encore commencé : Codex attend une décision, ci-dessous.</div>');
    return;
  }
  if (!chatSession) { box.innerHTML = '<div class="placeholder">Les conversations apparaissent ici dès qu\'une session Claude démarre dans ce worktree.</div>'; chatSignature = null; return; }
  let chat;
  try {
    const res = await api(`/api/chat?session=${encodeURIComponent(chatSession)}`);
    if (!res.ok) { box.innerHTML = '<div class="placeholder">Transcript introuvable pour cette session.</div>'; chatSignature = null; return; }
    chat = await res.json();
  } catch { return; }
  const last = chat.items[chat.items.length - 1];
  const session = currentSession();
  const awaiting = session?.status === 'needs_input' && !(typeof promptAnswered === 'function' && promptAnswered(session)) ? session.message || 'Claude attend ta réponse' : null;
  const lane = chat.totals?.agents > 0 ? chatLane : 'conversation';
  const signature = `${chat.sessionId}|${lane}|${chat.agentTurns}|${seenAgentTurns(chatSession)}|${chat.total}|${last ? (last.result || last.text || '').length : 0}|${awaiting}`;
  if (!force && signature === chatSignature) return;
  chatSignature = signature;
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  const opened = new Set([...box.querySelectorAll('details.tool[open]')].map((d) => d.dataset.index));
  const time = (at) => (at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  const lastIndex = chat.items.length - 1;
  chatItems = chat.items;
  renderChatLanes(chat);
  const shown = chat.items.filter((item) => !item.lane || item.lane === lane || (lane === 'conversation' && item.forUser)).length;
  const hiddenCount = (chat.totals ? chat.totals[lane] : chat.total) - shown;
  box.innerHTML = (hiddenCount > 0 ? `<div class="placeholder">${hiddenCount} éléments plus anciens masqués</div>` : '') + chat.items.map((item, i) => {
    if (item.lane && item.lane !== lane && !(lane === 'conversation' && item.forUser)) return '';
    const mark = awaiting && i === lastIndex ? 'awaiting' : '';
    if (item.kind === 'user') {
      return `<div class="msg user ${item.lane === 'agents' ? 'cockpit' : ''} ${mark}">${escLink(item.text)}<span class="when">${time(item.at)}</span></div>`;
    }
    if (item.kind === 'assistant') return `<div class="msg assistant ${item.milestone ? 'milestone' : ''} ${mark}">${item.milestone ? '<span class="milestone-tag">Jalon</span>' : ''}${item.text.length > 900 ? `<button class="read-top" data-read="${i}" title="Ouvrir dans le lecteur (l)">Lire ⤢</button>` : ''}${md(item.text)}<span class="when">${time(item.at)}<button class="read" data-read="${i}">Lecteur</button><button class="delegate" data-delegate="${i}" title="Lancer une session liée pour cette sous-tâche">Déléguer</button></span></div>`;
    return `<details class="tool ${item.error ? 'error' : ''} ${mark}" data-index="${i}" ${opened.has(String(i)) ? 'open' : ''}><summary><b>${esc(item.tool)}</b><span>${escLink(item.detail)}</span></summary>${item.result ? `<pre>${escLink(item.result)}</pre>` : ''}</details>`;
  }).join('') + (awaiting ? `<div class="awaiting-note">${esc(awaiting)}${session.live ? ' · <button data-goto="term">Répondre dans le terminal</button>' : ''}</div>` : '');
  if (nearBottom || force) box.scrollTop = box.scrollHeight;
}

// One send, like the CLI: the server delivers the message to the session (taken into account during its
// turn), holds it while Claude waits on a question, or starts a parallel session for an independent task.
const SENT_NOTE = {
  queued: 'Claude attend ta réponse à sa question : ton message part juste après.',
  parallel: 'Tâche indépendante : lancée dans une nouvelle session de ce worktree.',
};

async function sendMessage() {
  const input = $('composer-input');
  const text = input.value.trim();
  const wt = currentWt();
  if (!text || !chatSession) return;
  hideSuggest();
  input.value = '';
  autosizeComposer();
  const known = new Set((wt?.sessions || []).map((s) => s.sessionId));
  const result = await post('/api/message', { target: chatSession, text });
  if (!result.ok) {
    if (!input.value.trim()) { input.value = text; autosizeComposer(); }
    toast(result.data.error || 'Envoi impossible.', 'error');
    return;
  }
  const { route, reason, during } = result.data;
  if (route === 'parallel' && wt) pendingParallel = { path: wt.path, known, at: Date.now() };
  const note = route === 'session' ? (during ? 'Envoyé : Claude en tient compte pendant son tour.' : null) : SENT_NOTE[route];
  if (note) toast(reason && route === 'parallel' ? `${note} (${reason})` : note);
  setTimeout(() => { loadChat(true); refresh(); }, route === 'parallel' ? 2500 : 900);
}
