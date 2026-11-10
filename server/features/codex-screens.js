const path = require('node:path');
const { REPO, TMUX_SIZE, TMUX_PATH } = require('../config');
const { tmux, sleep } = require('../io/exec');
const { loadStore, saveStore, readSessions, readSession } = require('../io/store');
const { parseCodexPrompt, choiceKeys, activeChoiceKeys, permissionChoiceKeys } = require('../core/codex-screen');
const { sendOps, resolveTarget } = require('./terminal');

// Codex asks some questions before its hooks run (trust this folder, review the hooks): until then the
// cockpit has no state for the session. It remembers the Codex sessions it launches, reads the screen of
// those not attached yet, and shows their prompt; the user's choice is relayed to Codex, which saves it.
const STORE = 'worktree-codex-launches.json';
const KEEP_MS = 24 * 3600 * 1000;

function registerCodexLaunch(tmuxName, cwd, extra = {}) {
  const list = loadStore(STORE, []).filter((l) => l.tmux !== tmuxName && Date.now() - l.at < KEEP_MS);
  saveStore(STORE, [...list, { tmux: tmuxName, cwd, at: Date.now(), ...extra }].slice(-100));
}

async function paneIds() {
  const out = await tmux(['list-panes', '-a', '-F', '#{session_name}\t#{pane_id}\t#{pane_dead}']);
  const map = new Map();
  for (const line of out.ok ? out.stdout.split('\n') : []) {
    const [session, pane, dead] = line.split('\t');
    if (session && dead !== '1' && !map.has(session)) map.set(session, pane);
  }
  return map;
}

async function screenOf(tmuxName) {
  const out = await tmux(['capture-pane', '-p', '-J', '-t', `${tmuxName}:`]);
  return out.ok ? out.stdout : '';
}

// Cockpit-launched Codex sessions that are alive but not attached to a state file yet, with their prompt.
async function pendingScreens() {
  const launches = loadStore(STORE, []);
  if (!launches.length) return [];
  const panes = await paneIds();
  const attached = new Set(readSessions().filter((s) => s.provider === 'codex' && s.tmuxPane).map((s) => s.tmuxPane));
  const alive = launches.filter((l) => panes.has(l.tmux) && Date.now() - l.at < KEEP_MS);
  if (alive.length !== launches.length) saveStore(STORE, alive);
  const out = [];
  for (const l of alive) {
    const pane = panes.get(l.tmux);
    if (attached.has(pane)) continue;
    const screen = await screenOf(l.tmux);
    // Codex runs its hooks from the first request on: a session that has answered but is still not
    // attached is the sign its hooks are not trusted.
    out.push({ ...l, pane, prompt: parseCodexPrompt(screen), answered: /Worked for \d|Ran for \d/.test(screen) });
  }
  return out;
}

async function answerScreen({ tmux: tmuxName, session, option, label }) {
  let target;
  if (session) {
    const state = readSession(String(session));
    if (!state || state.provider !== 'codex' || state.status !== 'needs_input') return { error: 'Session GPT sans question en attente.' };
    const expected = state.question?.options?.[Number(option) - 1];
    if (!expected || expected !== label) return { error: 'La question a changé : réponds dans le terminal.' };
    target = await resolveTarget(session);
  } else {
    const launch = loadStore(STORE, []).find((l) => l.tmux === String(tmuxName || ''));
    if (!launch) return { error: 'Session GPT inconnue.' };
    target = `${launch.tmux}:`;
  }
  if (!target) return { error: 'Terminal GPT indisponible.' };
  const screen = await tmux(['capture-pane', '-p', '-J', '-t', target]);
  const prompt = parseCodexPrompt(screen.ok ? screen.stdout : '');
  if (!prompt) return { error: 'Codex n’attend plus de choix sur cet écran.' };
  const keys = session ? activeChoiceKeys(screen.stdout, option, label) : choiceKeys(prompt, option);
  if (!keys) return { error: 'Le choix affiché est illisible ou a changé : réponds dans le terminal.' };
  const sent = await sendOps(target, keys);
  if (sent.error) return sent;
  for (let i = 0; i < 8; i++) {
    await sleep(250);
    const next = await tmux(['capture-pane', '-p', '-J', '-t', target]);
    if (!next.ok) return { error: next.stderr || 'Impossible de vérifier la réponse dans le terminal.' };
    const current = parseCodexPrompt(next.stdout);
    if (!current || current.text !== prompt.text || current.options.map((o) => o.label).join('\n') !== prompt.options.map((o) => o.label).join('\n')) return { ok: true };
  }
  return { error: 'Codex affiche toujours la même question : la réponse n’est pas confirmée. Vérifie le terminal avant de réessayer.' };
}

async function answerPermission({ session, decision }) {
  const state = readSession(String(session || ''));
  if (!state || state.provider !== 'codex' || state.status !== 'needs_input' || !state.permission) return { error: 'Aucune permission GPT en attente.' };
  const target = await resolveTarget(session);
  if (!target) return { error: 'Terminal GPT indisponible.' };
  const captured = await tmux(['capture-pane', '-p', '-J', '-t', target]);
  if (!captured.ok) return { error: captured.stderr || 'Lecture du terminal impossible.' };
  const keys = permissionChoiceKeys(captured.stdout, decision);
  if (!keys) return { error: 'Choix de permission illisible ou ambigu : réponds dans le terminal.' };
  const sent = await sendOps(target, keys);
  if (sent.error) return sent;
  for (let i = 0; i < 8; i++) {
    await sleep(250);
    const next = await tmux(['capture-pane', '-p', '-J', '-t', target]);
    if (!next.ok) return { error: next.stderr || 'Impossible de vérifier la permission dans le terminal.' };
    if (!permissionChoiceKeys(next.stdout, decision)) return { ok: true };
  }
  return { error: 'Codex affiche toujours la même permission : la réponse n’est pas confirmée. Vérifie le terminal avant de réessayer.' };
}

// "Autoriser GPT sur ce dépôt": a bare Codex session in the repository, so that Codex shows its trust
// prompts there once, before any real work.
async function setupRepo({ repo, args, bin }) {
  // args end with a tiny request: Codex only runs its hooks once a turn starts.
  const name = `cw-codex-setup-${path.basename(repo).replace(/[^\w-]/g, '_')}`.slice(0, 60);
  await tmux(['kill-session', '-t', name]);
  const started = await tmux(['new-session', '-d', '-s', name, ...TMUX_SIZE, '-c', repo, '-e', TMUX_PATH, bin, ...args]);
  if (!started.ok) return { error: started.stderr.trim() || 'Lancement impossible.' };
  registerCodexLaunch(name, repo, { setup: true });
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const prompt = parseCodexPrompt(await screenOf(name));
    if (prompt) return { ok: true, tmux: name, prompt };
  }
  return { ok: true, tmux: name, prompt: null };
}

async function setupState({ tmux: tmuxName }) {
  const launch = loadStore(STORE, []).find((l) => l.tmux === String(tmuxName || '') && l.setup);
  if (!launch) return { done: true };
  const panes = await paneIds();
  if (!panes.has(launch.tmux)) return { done: true };
  const attached = readSessions().some((s) => s.provider === 'codex' && s.tmuxPane === panes.get(launch.tmux));
  const screen = await screenOf(launch.tmux);
  return { done: false, attached, prompt: parseCodexPrompt(screen), answered: /Worked for \d|Ran for \d/.test(screen) };
}

async function endSetup({ tmux: tmuxName }) {
  const launch = loadStore(STORE, []).find((l) => l.tmux === String(tmuxName || '') && l.setup);
  if (launch) await tmux(['kill-session', '-t', launch.tmux]);
  return { ok: true };
}

// Opens Codex's own hook review in a session whose hooks are not trusted yet.
async function openHooks({ tmux: tmuxName }) {
  const launch = loadStore(STORE, []).find((l) => l.tmux === String(tmuxName || ''));
  if (!launch) return { error: 'Session GPT inconnue.' };
  if (parseCodexPrompt(await screenOf(launch.tmux))) return { error: 'Codex attend déjà un choix : réponds-y d’abord.' };
  const typed = await sendOps(`${launch.tmux}:`, [{ literal: '/hooks' }]);
  if (typed.error) return typed;
  await sleep(300);
  const sent = await sendOps(`${launch.tmux}:`, [{ key: 'Enter' }]);
  if (sent.error) return sent;
  await sleep(1000);
  return { ok: true, prompt: parseCodexPrompt(await screenOf(launch.tmux)), screen: (await screenOf(launch.tmux)).trim().split('\n').slice(-25).join('\n') };
}

module.exports = { openHooks, registerCodexLaunch, pendingScreens, answerScreen, answerPermission, setupRepo, setupState, endSetup, REPO };
