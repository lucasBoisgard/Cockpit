// Questions and permission prompts answered in the conversation instead of the terminal. A question held
// by the ask-relay hook is answered through /api/ask/answer; a session the relay does not cover (started
// outside the cockpit) and permission prompts are answered with the provider's keys.
const askDrafts = new Map();
const askAnswered = new Set();
let askSignature = '';
let askSending = false;

function askDraft(toolUseId) {
  if (!askDrafts.has(toolUseId)) askDrafts.set(toolUseId, {});
  return askDrafts.get(toolUseId);
}

function askAnswers(ask) {
  const draft = askDraft(ask.toolUseId);
  const answers = {};
  for (const q of ask.questions) {
    const d = draft[q.question] || { picked: [], other: '' };
    const values = [...d.picked, ...(d.other.trim() ? [d.other.trim()] : [])];
    answers[q.question] = q.multiSelect ? values : values.slice(-1);
  }
  return answers;
}

const askComplete = (ask) => Object.values(askAnswers(ask)).every((v) => v.length);

function askForm(ask) {
  const draft = askDraft(ask.toolUseId);
  const questions = ask.questions.map((q, qi) => {
    const d = draft[q.question] || { picked: [], other: '' };
    const options = q.options.map((o, oi) => `<button type="button" class="ask-option ${d.picked.includes(o.label) ? 'is-on' : ''}" role="${q.multiSelect ? 'checkbox' : 'radio'}" aria-checked="${d.picked.includes(o.label)}" data-ask-q="${qi}" data-ask-o="${oi}">
        <span class="ask-mark">${q.multiSelect ? (d.picked.includes(o.label) ? '☑' : '☐') : d.picked.includes(o.label) ? '◉' : '○'}</span><span><b>${esc(o.label)}</b>${o.description ? `<small>${esc(o.description)}</small>` : ''}</span></button>`).join('');
    return `<fieldset class="ask-q"><legend>${q.header ? `<span class="ask-header">${esc(q.header)}</span>` : ''}${esc(q.question)}${q.multiSelect ? ' <small>(plusieurs choix)</small>' : ''}</legend>
      <div class="ask-options">${options}</div>
      <input class="ask-other" data-ask-other="${qi}" value="${esc(d.other)}" placeholder="${q.options.length ? 'Autre réponse…' : 'Ta réponse…'}" autocomplete="off"></fieldset>`;
  }).join('');
  return `<div class="ask-title"><span class="ask-dot"></span>Claude te pose ${ask.questions.length > 1 ? `${ask.questions.length} questions` : 'une question'}</div>${questions}
    <div class="ask-buttons"><button class="btn ask-send" data-ask-send ${askComplete(ask) && !askSending ? '' : 'disabled'}>${askSending ? 'Envoi…' : 'Répondre'}</button><button class="btn" data-ask-defer>Répondre dans le terminal</button></div>`;
}

function keyCard(s) {
  const keys = keysOf(s);
  const op = (k) => esc(JSON.stringify(k));
  if (s.permission) {
    if (s.provider === 'codex') return `<div class="ask-title"><span class="ask-dot"></span>${esc(s.message || 'Permission demandée')}</div>
      <div class="ask-buttons"><button class="btn ask-send" data-codex-permission="allow">Autoriser</button><button class="btn" data-codex-permission="always">Toujours autoriser</button><button class="btn" data-codex-permission="deny">Refuser</button></div>`;
    return `<div class="ask-title"><span class="ask-dot"></span>${esc(s.message || 'Permission demandée')}</div>
      <div class="ask-buttons"><button class="btn ask-send" data-ask-key="${op(keys.allow)}">Autoriser</button><button class="btn" data-ask-key="${op(keys.always)}">Toujours autoriser</button><button class="btn" data-ask-key="${op(keys.deny)}">Refuser</button></div>`;
  }
  const q = s.question;
  if (s.provider === 'codex') return `<div class="ask-title"><span class="ask-dot"></span>${esc(q.text)}</div>
    <div class="ask-options">${q.options.map((o, i) => `<button type="button" class="ask-option" data-codex-option="${i + 1}" data-codex-label="${esc(o)}"><span class="ask-mark">${i + 1}</span><span><b>${esc(o)}</b></span></button>`).join('')}</div>
    <p class="ask-note">Pour une réponse libre ou plusieurs questions, utilise le terminal.</p>`;
  return `<div class="ask-title"><span class="ask-dot"></span>${esc(q.text)}</div>
    <div class="ask-options">${q.options.map((o, i) => `<button type="button" class="ask-option" data-ask-key="${op({ literal: String(i + 1) })}"><span class="ask-mark">${i + 1}</span><span><b>${esc(o)}</b></span></button>`).join('')}</div>
    <p class="ask-note">Session lancée hors du cockpit : le choix est tapé dans son terminal. Pour une réponse libre, utilise l’onglet Terminal.</p>`;
}

// A Codex prompt shown on its screen before its hooks run (trust the folder, review the hooks…).
function screenCard(screen) {
  const p = screen.prompt;
  if (!p) {
    return `<div class="ask-title"><span class="ask-dot"></span>GPT a répondu, mais le cockpit ne reçoit pas son état</div>
      <p class="ask-note">Ses hooks ne sont pas validés dans Codex. Le bouton ouvre la revue des hooks dans le terminal de la session : fais confiance aux hooks « worktree-state.js » (flèches puis Entrée), puis Échap. C’est à faire une fois.</p>
      <div class="ask-buttons"><button class="btn ask-send" data-screen-hooks="${esc(screen.tmux)}">Ouvrir la revue des hooks dans le terminal</button></div>`;
  }
  const what = p.kind === 'folder' ? 'GPT demande s’il peut travailler dans ce dépôt' : p.kind === 'hooks' ? 'GPT demande de valider des hooks' : 'GPT attend un choix';
  return `<div class="ask-title"><span class="ask-dot"></span>${what}</div>
    <pre class="ask-screen">${esc(p.text)}</pre>
    <div class="ask-options">${p.options.map((o) => `<button type="button" class="ask-option" data-screen-option="${o.n}" data-tmux="${esc(screen.tmux)}"><span class="ask-mark">${o.n}</span><span><b>${esc(o.label)}</b></span></button>`).join('')}</div>
    <p class="ask-note">Ton choix est envoyé à Codex comme si tu le tapais dans son terminal ; c’est Codex qui l’enregistre.</p>`;
}

// Shows a cockpit-launched Codex session's terminal (its hook review is driven there with the keyboard).
function openCodexTerminal(tmuxName) {
  const id = `codex-screen:${tmuxName}`;
  const wt = state.worktrees.find((w) => w.sessions.some((x) => x.sessionId === id));
  if (wt && wt.path !== selected) select(wt.path);
  chatSession = id;
  chatBarSignature = null;
  tab = 'term';
  renderTabs();
  renderPanel();
  loadScreen();
  $('screen').focus();
  toast('Revue des hooks de Codex : flèches et Entrée pour faire confiance, Échap pour sortir.');
}

// Whether the prompt a session shows has just been answered from the card (used by the conversation too).
function promptAnswered(s) {
  if (!s || s.status !== 'needs_input') return false;
  return [...askAnswered].some((k) => k.startsWith(`${s.sessionId}|`) && k.includes(`|${s.message || ''}|`));
}

// The prompt the card currently shows: once answered, the card hides until another prompt comes.
let askShown = '';
function markAnswered() {
  if (askShown) askAnswered.add(askShown);
  redrawAsk();
  chatSignature = null;
  if (typeof loadChat === 'function') loadChat(false);
}
function unmarkAnswered(key) {
  askAnswered.delete(key);
  redrawAsk();
}

function renderAskCard() {
  const card = $('ask-card');
  const s = currentSession();
  let mode = !s?.live || s.status !== 'needs_input' ? null : s.codexScreen ? 'screen' : s.ask ? 'ask' : s.question?.options?.length ? 'keys' : s.permission ? 'perm' : null;
  const prompt = mode ? `${s.sessionId}|${mode}|${s.ask?.toolUseId || ''}|${s.message || ''}|${JSON.stringify(s.codexScreen?.prompt || null)}` : '';
  if (prompt && askAnswered.has(prompt)) mode = null;
  const signature = mode ? `${prompt}|${askSending}` : '';
  if (signature === askSignature && !askRedraw) return;
  askSignature = signature;
  askRedraw = false;
  askShown = mode ? prompt : '';
  card.hidden = !mode;
  if (!mode) { card.innerHTML = ''; return; }
  const focused = document.activeElement?.dataset?.askOther;
  card.innerHTML = mode === 'ask' ? askForm(s.ask) : mode === 'screen' ? screenCard(s.codexScreen) : keyCard(s);
  if (focused !== undefined) { const input = card.querySelector(`[data-ask-other="${focused}"]`); if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } }
}
let askRedraw = false;
const redrawAsk = () => { askRedraw = true; renderAskCard(); };

async function sendAsk(body, done) {
  const key = askShown;
  markAnswered();
  const result = await post('/api/ask/answer', body);
  if (!result.ok) { unmarkAnswered(key); toast(result.data.error || 'Réponse impossible.', 'error'); return; }
  toast(done);
  setTimeout(() => { loadChat(true); refresh(); }, 900);
}

$('ask-card').addEventListener('click', (e) => {
  const s = currentSession();
  if (!s) return;
  const screenOption = e.target.closest('[data-screen-option]');
  if (screenOption) {
    post('/api/codex/screen', { tmux: screenOption.dataset.tmux, option: Number(screenOption.dataset.screenOption) }).then((r) => { toast(r.ok ? 'Codex a accepté le choix.' : r.data.error || 'Envoi impossible.', r.ok ? '' : 'error'); refresh(); });
    return;
  }
  const hooks = e.target.closest('[data-screen-hooks]');
  if (hooks) {
    post('/api/codex/hooks', { tmux: hooks.dataset.screenHooks }).then((r) => {
      if (!r.ok) { toast(r.data.error || 'Ouverture impossible.', 'error'); return; }
      openCodexTerminal(hooks.dataset.screenHooks);
    });
    return;
  }
  const codexOption = e.target.closest('[data-codex-option]');
  if (codexOption) {
    post('/api/codex/screen', { session: s.sessionId, option: Number(codexOption.dataset.codexOption), label: codexOption.dataset.codexLabel }).then((r) => { toast(r.ok ? 'Codex a accepté le choix.' : r.data.error || 'Envoi impossible.', r.ok ? '' : 'error'); refresh(); });
    return;
  }
  const codexPermission = e.target.closest('[data-codex-permission]');
  if (codexPermission) {
    post('/api/codex/permission', { session: s.sessionId, decision: codexPermission.dataset.codexPermission }).then((r) => { toast(r.ok ? 'Codex a accepté la réponse.' : r.data.error || 'Envoi impossible.', r.ok ? '' : 'error'); refresh(); });
    return;
  }
  const key = e.target.closest('[data-ask-key]');
  if (key) {
    const answered = askShown;
    markAnswered();
    post('/api/keys', { target: s.sessionId, ops: [JSON.parse(key.dataset.askKey)] }).then((r) => { if (!r.ok) unmarkAnswered(answered); toast(r.ok ? 'Réponse envoyée.' : r.data.error || 'Envoi impossible.', r.ok ? '' : 'error'); setTimeout(refresh, 800); });
    return;
  }
  const ask = s.ask;
  if (!ask) return;
  const option = e.target.closest('[data-ask-o]');
  if (option) {
    const q = ask.questions[Number(option.dataset.askQ)];
    const label = q.options[Number(option.dataset.askO)].label;
    const draft = askDraft(ask.toolUseId);
    const d = draft[q.question] || (draft[q.question] = { picked: [], other: '' });
    if (q.multiSelect) d.picked = d.picked.includes(label) ? d.picked.filter((l) => l !== label) : [...d.picked, label];
    else { d.picked = d.picked.includes(label) ? [] : [label]; d.other = ''; }
    redrawAsk();
    return;
  }
  if (e.target.closest('[data-ask-send]') && askComplete(ask)) { sendAsk({ session: s.sessionId, toolUseId: ask.toolUseId, answers: askAnswers(ask) }, 'Réponse envoyée à Claude.'); return; }
  if (e.target.closest('[data-ask-defer]')) sendAsk({ session: s.sessionId, toolUseId: ask.toolUseId, defer: true }, 'La question s’affiche dans le terminal.');
});

$('ask-card').addEventListener('input', (e) => {
  const s = currentSession();
  const input = e.target.closest('[data-ask-other]');
  if (!s?.ask || !input) return;
  const q = s.ask.questions[Number(input.dataset.askOther)];
  const draft = askDraft(s.ask.toolUseId);
  const d = draft[q.question] || (draft[q.question] = { picked: [], other: '' });
  d.other = input.value;
  if (!q.multiSelect && input.value.trim()) d.picked = [];
  const send = $('ask-card').querySelector('[data-ask-send]');
  if (send) send.disabled = !askComplete(s.ask) || askSending;
  $('ask-card').querySelectorAll(`[data-ask-q="${input.dataset.askOther}"]`).forEach((b) => {
    const on = d.picked.includes(q.options[Number(b.dataset.askO)].label);
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-checked', String(on));
    b.querySelector('.ask-mark').textContent = q.multiSelect ? (on ? '☑' : '☐') : on ? '◉' : '○';
  });
});

$('ask-card').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.closest('[data-ask-other]')) { e.preventDefault(); $('ask-card').querySelector('[data-ask-send]:not([disabled])')?.click(); }
});
