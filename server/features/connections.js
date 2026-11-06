const { CLAUDE_BIN, TMUX_SIZE, TMUX_PATH, REPO } = require('../config');
const { run, tmux, sleep } = require('../io/exec');
const { CODEX_BIN, codexInfo, forgetCodexInfo } = require('./providers');
const { pasteText } = require('./terminal');

// Signing the agents in from the cockpit, which runs in a container without a browser: each login runs in
// its own tmux session; the cockpit reads the link (and Codex's one-time code) from its screen and shows
// them, and the code Claude's page gives back is pasted into that session.
const LOGIN = { claude: 'cw-login-claude', codex: 'cw-login-codex' };
const URL_RE = /https:\/\/\S+/;

async function claudeStatus() {
  const result = await run(CLAUDE_BIN, ['auth', 'status']);
  try {
    const s = JSON.parse(result.stdout);
    return { loggedIn: !!s.loggedIn, method: s.authMethod || null, email: s.email || null, expiresAt: s.loginExpiresAt ? Date.parse(s.loginExpiresAt) : null };
  } catch {
    return { loggedIn: false, method: null, email: null, expiresAt: null };
  }
}

async function codexStatus() {
  forgetCodexInfo();
  const info = await codexInfo();
  const result = info.installed ? await run(CODEX_BIN, ['login', 'status']) : null;
  const text = `${result?.stdout || ''}${result?.stderr || ''}`.trim();
  return { installed: info.installed, loggedIn: info.loggedIn, method: info.loggedIn ? (/api key/i.test(text) ? 'clé d’API' : /chatgpt/i.test(text) ? 'compte ChatGPT' : null) : null, detail: text.split('\n')[0] || '' };
}

async function status() {
  const [claude, codex] = await Promise.all([claudeStatus(), codexStatus()]);
  const pending = {};
  for (const [id, name] of Object.entries(LOGIN)) pending[id] = (await tmux(['has-session', '-t', name])).ok;
  return { claude, codex, pending };
}

async function screenOf(name) {
  const out = await tmux(['capture-pane', '-p', '-J', '-t', name]);
  return out.ok ? out.stdout : '';
}

async function startLogin(id, command) {
  await tmux(['kill-session', '-t', LOGIN[id]]);
  const started = await tmux(['new-session', '-d', '-s', LOGIN[id], ...TMUX_SIZE, '-c', REPO, '-e', TMUX_PATH, ...command]);
  if (!started.ok) return { error: started.stderr.trim() || 'Lancement impossible.' };
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    const screen = await screenOf(LOGIN[id]);
    const url = screen.match(URL_RE)?.[0];
    const code = id === 'codex' ? screen.match(/\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/)?.[0] : null;
    if (url && (id !== 'codex' || code)) return { ok: true, url, code };
    if (!(await tmux(['has-session', '-t', LOGIN[id]])).ok) return { error: 'La connexion s’est arrêtée avant d’afficher son lien.' };
  }
  return { error: 'Pas de lien de connexion au bout de 20 s.' };
}

// Codex with a ChatGPT account: device code, valid 15 minutes; Codex finishes by itself once approved.
async function codexDeviceLogin() {
  const info = await codexInfo();
  if (!info.installed) return { error: 'Codex CLI n’est pas installé sur cette machine (npm install -g @openai/codex).' };
  return startLogin('codex', [CODEX_BIN, 'login', '--device-auth']);
}

// Codex with an API key: handed to Codex on stdin, never stored or logged by the cockpit.
async function codexApiKey({ key }) {
  const value = String(key || '').trim();
  if (!/^sk-[\w-]{20,}$/.test(value)) return { error: 'Clé d’API OpenAI invalide (elle commence par sk-).' };
  const result = await run(CODEX_BIN, ['login', '--with-api-key'], `${value}\n`);
  forgetCodexInfo();
  return result.ok ? { ok: true } : { error: (result.stderr || 'Connexion refusée.').split('\n')[0] };
}

async function claudeLogin({ console: useConsole }) {
  return startLogin('claude', [CLAUDE_BIN, 'auth', 'login', ...(useConsole ? ['--console'] : [])]);
}

async function claudeCode({ code }) {
  const value = String(code || '').trim();
  if (!value || value.length > 400 || /\s/.test(value)) return { error: 'Code invalide.' };
  if (!(await tmux(['has-session', '-t', LOGIN.claude])).ok) return { error: 'Plus de connexion Claude en cours : relance-la.' };
  await pasteText(`${LOGIN.claude}:`, value);
  await sleep(150);
  await tmux(['send-keys', '-t', `${LOGIN.claude}:`, 'Enter']);
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if ((await claudeStatus()).loggedIn && !(await tmux(['has-session', '-t', LOGIN.claude])).ok) return { ok: true };
  }
  const screen = (await screenOf(LOGIN.claude)).trim().split('\n').filter(Boolean).slice(-2).join(' ');
  return (await claudeStatus()).loggedIn ? { ok: true } : { error: screen ? `Claude : ${screen.slice(0, 200)}` : 'Connexion non confirmée.' };
}

async function cancelLogin({ id }) {
  if (!LOGIN[id]) return { error: 'Connexion inconnue.' };
  await tmux(['kill-session', '-t', LOGIN[id]]);
  return { ok: true };
}

module.exports = { status, codexDeviceLogin, codexApiKey, claudeLogin, claudeCode, cancelLogin };
