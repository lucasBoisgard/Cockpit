const path = require('node:path');
const { REPO, TMUX_SIZE, TMUX_PATH } = require('../config');
const { tmux, sleep } = require('../io/exec');
const { loadStore, saveStore, readSessions } = require('../io/store');
const { parseCodexPrompt, choiceKeys } = require('../core/codex-screen');
const { sendOps } = require('./terminal');

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

async function answerScreen({ tmux: tmuxName, option }) {
  const launch = loadStore(STORE, []).find((l) => l.tmux === String(tmuxName || ''));
  if (!launch) return { error: 'Session GPT inconnue.' };
  const prompt = parseCodexPrompt(await screenOf(launch.tmux));
  if (!prompt) return { error: 'Codex n’attend plus de choix sur cet écran.' };
  const keys = choiceKeys(prompt, option);
  if (!keys) return { error: 'Choix inconnu.' };
  await sendOps(`${launch.tmux}:`, keys);
  await sleep(800);
  return { ok: true, next: parseCodexPrompt(await screenOf(launch.tmux)) };
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
  await sendOps(`${launch.tmux}:`, [{ literal: '/hooks' }]);
  await sleep(300);
  await sendOps(`${launch.tmux}:`, [{ key: 'Enter' }]);
  await sleep(1000);
  return { ok: true, prompt: parseCodexPrompt(await screenOf(launch.tmux)), screen: (await screenOf(launch.tmux)).trim().split('\n').slice(-25).join('\n') };
}

module.exports = { openHooks, registerCodexLaunch, pendingScreens, answerScreen, setupRepo, setupState, endSetup, REPO };
