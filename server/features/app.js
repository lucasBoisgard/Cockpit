const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { REPO, APP, APP_SESSION, USE_PM2, PM2_BIN, PM2_PID_FILE, MIGRATIONS, DATA_DIR, TMUX_SIZE, TMUX_PATH } = require('../config');
const { run, git, tmux, sleep } = require('../io/exec');
const { processAlive, procRead, procCwd, listeningPortsBySocket, processPorts } = require('../io/proc');
const { loadStore, saveStore, removeStore } = require('../io/store');
const { stripAnsi, lastLineOf, parsePm2List, parseBuildPane, appVerdict, isRunning, startRefusal, launchCommand, survivorsError, staleIndexLock, restartAfterSync } = require('../core/app');
const { invalidateSnapshot } = require('../cache');
const { listWorktrees, worktreeName } = require('./worktrees');
const { pushEvent } = require('./events');

// Dev servers, watchers and services the app command starts, outlived by their pm2 daemon or an older run
const APP_PROCESS_PATTERN = /node_modules\/\.bin\/(vite|storybook)\b|node_modules\/storybook\/|\bnx(\.js)? watch\b|--conditions=nodeDev\b/;
const STRAY_KILL_GRACE_MS = 5000;
const MIGRATIONS_STORE = 'worktree-app-migrations.json';
const MIGRATIONS_CHECK_MS = 30000;
const SERVE_STORE = 'worktree-app-serve.json';

let migrating = false;
let syncing = false;
let lastMigrationsCheck = 0;

function pm2DaemonPid() {
  try {
    return Number(fs.readFileSync(PM2_PID_FILE, 'utf8').trim());
  } catch {
    return null;
  }
}

const pm2DaemonAlive = () => processAlive(pm2DaemonPid());

async function pm2Processes() {
  if (!USE_PM2 || !pm2DaemonAlive()) return [];
  const result = await run(PM2_BIN, ['jlist']);
  if (!result.ok) return [];
  try {
    return parsePm2List(result.stdout, Date.now()) || [];
  } catch {
    return [];
  }
}

function httpStatus(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(0));
  });
}

async function buildPane() {
  if (!(await tmux(['has-session', '-t', APP_SESSION])).ok) return null;
  const info = await tmux(['display-message', '-p', '-t', `${APP_SESSION}:`, '#{pane_dead}\t#{pane_dead_status}\t#{session_created}']);
  if (!info.ok) return null;
  const tail = await tmux(['capture-pane', '-p', '-J', '-t', `${APP_SESSION}:`, '-S', '-40']);
  return parseBuildPane(info.stdout, tail.stdout);
}

async function appState() {
  if (!APP) return null;
  const [build, processes, code] = await Promise.all([buildPane(), pm2Processes(), APP.healthUrl ? httpStatus(APP.healthUrl) : null]);
  const base = { link: APP.url || APP.healthUrl || null, usesPm2: USE_PM2, recoveryDoc: APP.recoveryDoc || null, build, processes, serving: loadStore(SERVE_STORE, null) };
  return appVerdict(base, { build, processes, code, healthUrl: APP.healthUrl });
}

// Claude sessions and their tools may run from the main checkout too: never touch them
function underClaude(pid, cmdlines) {
  for (let current = pid, depth = 0; current > 1 && depth < 50; depth++) {
    if (/(^|\/)claude(\s|$)|\.claude\//.test(cmdlines.get(current) ?? '')) return true;
    current = Number(/^\d+ \(.*\) \S (\d+)/s.exec(procRead(current, 'stat') || '')?.[1] || 0);
  }
  return false;
}

// Processes of the app still alive outside pm2: they keep their ports and push the next run onto other ones
function strayAppProcesses() {
  if (process.platform !== 'linux') return [];
  const worktreesDir = path.join(REPO, '.claude', 'worktrees');
  const listening = listeningPortsBySocket();
  const pids = fs.readdirSync('/proc').filter((entry) => /^\d+$/.test(entry)).map(Number);
  const cmdlines = new Map(pids.map((pid) => [pid, (procRead(pid, 'cmdline') || '').replace(/\0/g, ' ').trim()]));
  const pm2Daemon = pm2DaemonPid();
  return pids.flatMap((pid) => {
    if (pid === process.pid || pid === pm2Daemon) return [];
    const cwd = procCwd(pid);
    if (!cwd || !(cwd === REPO || cwd.startsWith(`${REPO}/`)) || cwd.startsWith(`${worktreesDir}/`)) return [];
    const cmd = cmdlines.get(pid);
    const ports = processPorts(pid, listening);
    if (!ports.length && !APP_PROCESS_PATTERN.test(cmd)) return [];
    if (underClaude(pid, cmdlines)) return [];
    return [{ pid, ports, cmd: cmd.slice(0, 120) }];
  });
}

async function killStrayAppProcesses() {
  const strays = strayAppProcesses();
  for (const { pid } of strays) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {}
  }
  const deadline = Date.now() + STRAY_KILL_GRACE_MS;
  let alive = strays;
  while (alive.length && Date.now() < deadline) {
    await sleep(250);
    alive = alive.filter(({ pid }) => fs.existsSync(`/proc/${pid}`));
  }
  for (const { pid } of alive) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {}
  }
  await sleep(500);
  return strayAppProcesses();
}

// Stops every process of the app, pm2-managed or not, so a new run gets its own ports back
async function clearApp() {
  await tmux(['kill-session', '-t', APP_SESSION]);
  if (USE_PM2 && pm2DaemonAlive()) await run(PM2_BIN, ['delete', 'all']);
  const survivors = await killStrayAppProcesses();
  return survivors.length ? { error: survivorsError(survivors) } : { ok: true };
}

// Tree hashes of the migration folders at HEAD: a pull that brings a migration changes them
async function migrationsFingerprint() {
  const hashes = await Promise.all(MIGRATIONS.paths.map((p) => git(REPO, ['rev-parse', `HEAD:${p}`])));
  return hashes.map((h) => (h || '').trim()).join(',');
}

async function pendingMigrations() {
  if (!MIGRATIONS) return null;
  const fingerprint = await migrationsFingerprint();
  return fingerprint === loadStore(MIGRATIONS_STORE, {}).fingerprint ? null : fingerprint;
}

async function startApp({ restart }) {
  const refusal = startRefusal(await appState(), restart);
  if (refusal) return { error: refusal };
  const cleared = await clearApp();
  if (cleared.error) return cleared;
  // Migrations run after the app command, once it has built what they need
  const pending = await pendingMigrations();
  const command = launchCommand({ command: APP.command, migrationsCommand: MIGRATIONS?.command, pending, storeFile: path.join(DATA_DIR, MIGRATIONS_STORE) });
  const result = await tmux([
    'new-session', '-d', '-s', APP_SESSION, ...TMUX_SIZE, '-c', REPO, '-e', TMUX_PATH,
    'bash', '-lc', USE_PM2 ? `"${PM2_BIN}" delete all >/dev/null 2>&1; ${command}` : command,
    ';', 'set-option', '-t', APP_SESSION, 'remain-on-exit', 'on',
  ]);
  return result.ok ? { ok: true } : { error: result.stderr.trim() };
}

async function stopApp() {
  return clearApp();
}

// A pull while the app runs brings no restart: run the new migrations against the running stack
async function migrateIfPulled(app) {
  if (!MIGRATIONS || migrating || Date.now() - lastMigrationsCheck < MIGRATIONS_CHECK_MS) return;
  lastMigrationsCheck = Date.now();
  if (!isRunning(app?.state) || app.build?.running) return;
  const pending = await pendingMigrations();
  if (!pending) return;
  migrating = true;
  try {
    const result = await new Promise((resolve) => {
      execFile('bash', ['-lc', MIGRATIONS.command], { cwd: REPO, env: { ...process.env, PATH: TMUX_PATH.slice('PATH='.length) }, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) =>
        resolve({ ok: !error, output: stripAnsi(`${stdout || ''}\n${stderr || ''}`) }),
      );
    });
    if (result.ok) {
      saveStore(MIGRATIONS_STORE, { fingerprint: pending, at: Date.now() });
      pushEvent({ type: 'migrations', worktree: 'app', message: 'Nouvelles migrations détectées après un pull : appliquées' });
    } else {
      pushEvent({ type: 'migrations_failed', worktree: 'app', message: `Migrations en échec : ${lastLineOf(result.output).slice(0, 200)}` });
    }
  } finally {
    migrating = false;
  }
}

// A git process working in the main checkout (the cockpit runs git elsewhere all the time)
async function gitRunning() {
  const pids = (await run('pgrep', ['-x', 'git'])).stdout.split('\n').filter(Boolean);
  return pids.some((pid) => (procCwd(pid) || '').startsWith(REPO));
}

// A git that crashed leaves .git/index.lock behind and every checkout fails: remove it once nothing uses it
async function clearStaleIndexLock() {
  const lock = path.join(REPO, '.git', 'index.lock');
  let ageMs;
  try {
    ageMs = Date.now() - fs.statSync(lock).mtimeMs;
  } catch {
    return;
  }
  if (staleIndexLock({ ageMs, gitRunning: await gitRunning() })) fs.rmSync(lock, { force: true });
}

// Hash of the root lockfiles: a change means new dependencies, which the running dev servers do not pick up
function depsFingerprint() {
  return ['yarn.lock', 'package-lock.json', 'pnpm-lock.yaml']
    .map((f) => {
      try {
        return crypto.createHash('sha1').update(fs.readFileSync(path.join(REPO, f))).digest('hex');
      } catch {
        return '';
      }
    })
    .join(',');
}

// Removes what the last sync wrote (tracked changes and copied untracked files); anything else is set aside in a tagged stash
async function clearMainCheckout(current) {
  await clearStaleIndexLock();
  // Only what the last sync wrote is thrown away: the main checkout must still be on the synced commit
  const head = ((await git(REPO, ['rev-parse', 'HEAD'])) || '').trim();
  if (current?.sha && head === current.sha) {
    await run('git', ['-C', REPO, 'reset', '--hard', '-q']);
    for (const file of current.untracked || []) fs.rmSync(path.join(REPO, file), { force: true });
  }
  const dirty = ((await git(REPO, ['status', '--porcelain'])) || '').trim();
  if (!dirty) return { ok: true };
  const tag = `cockpit-app-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const stash = await run('git', ['-C', REPO, 'stash', 'push', '-u', '-m', tag]);
  return stash.ok ? { ok: true, stashed: tag } : { error: `Impossible de mettre de côté les changements du checkout principal : ${stash.stderr.trim()}` };
}

// Puts the main checkout on the worktree's code: its HEAD, plus its uncommitted and untracked files
async function syncFrom(wt, current) {
  const cleared = await clearMainCheckout(current);
  if (cleared.error) return cleared;
  const head = ((await git(wt.path, ['rev-parse', 'HEAD'])) || '').trim();
  if (!head) return { error: `HEAD introuvable dans ${wt.path}.` };
  const checkout = await run('git', ['-C', REPO, 'checkout', '-q', '--detach', head]);
  if (!checkout.ok) return { error: checkout.stderr.trim() };
  const applied = await run('bash', ['-c', 'git -C "$1" diff HEAD --binary | git -C "$2" apply --binary --allow-empty', 'sync', wt.path, REPO]);
  if (!applied.ok) return { error: `Changements non commités non appliqués : ${applied.stderr.trim()}` };
  const untracked = ((await git(wt.path, ['ls-files', '--others', '--exclude-standard', '-z'])) || '').split('\0').filter(Boolean);
  for (const file of untracked) fs.cpSync(path.join(wt.path, file), path.join(REPO, file), { recursive: true });
  return { ok: true, head, untracked, stashed: cleared.stashed };
}

async function serveWorktree({ path: wtPath }) {
  if (!APP) return { error: 'Aucune app configurée.' };
  const wt = (await listWorktrees()).find((w) => w.path === wtPath);
  if (!wt?.head || wt.path === REPO) return { error: 'Worktree inconnu, ou checkout principal.' };
  if ((wt.repo || REPO) !== REPO) return { error: 'Seuls les worktrees du repo de l’app peuvent la servir.' };
  if (syncing) return { error: 'Une bascule de l’app est déjà en cours.' };
  syncing = true;
  try {
    const current = loadStore(SERVE_STORE, null);
    await clearStaleIndexLock();
    const previous = current?.previous || ((await git(REPO, ['branch', '--show-current'])) || '').trim() || ((await git(REPO, ['rev-parse', 'HEAD'])) || '').trim();
    const synced = await syncFrom(wt, current);
    if (synced.error) return synced;
    saveStore(SERVE_STORE, { name: worktreeName(wt.path), path: wt.path, branch: wt.branch, sha: synced.head, untracked: synced.untracked, previous, at: Date.now(), syncedAt: Date.now() });
    if (synced.stashed) pushEvent({ type: 'app_stash', worktree: 'app', message: `Changements du checkout principal mis de côté : stash « ${synced.stashed} »` });
    invalidateSnapshot();
    const started = await startApp({ restart: true });
    return started.error ? started : { ok: true, stashed: synced.stashed || null };
  } finally {
    syncing = false;
  }
}

// The served worktree finished a turn: bring its new code to the app, restart only if its dependencies changed
async function resyncServed() {
  const current = loadStore(SERVE_STORE, null);
  if (!current || syncing) return { ok: false };
  const wt = (await listWorktrees()).find((w) => w.path === current.path || worktreeName(w.path) === current.name);
  if (!wt) return { ok: false };
  syncing = true;
  try {
    const depsBefore = depsFingerprint();
    const synced = await syncFrom(wt, current);
    if (synced.error) {
      pushEvent({ type: 'app_sync_failed', worktree: 'app', message: `App non mise à jour depuis ${current.name} : ${synced.error.slice(0, 200)}` });
      return synced;
    }
    saveStore(SERVE_STORE, { ...current, path: wt.path, branch: wt.branch, sha: synced.head, untracked: synced.untracked, syncedAt: Date.now() });
    invalidateSnapshot();
    if (restartAfterSync({ depsBefore, depsAfter: depsFingerprint(), running: isRunning((await appState())?.state) })) await startApp({ restart: true });
    return { ok: true };
  } finally {
    syncing = false;
  }
}

async function unserveWorktree() {
  const current = loadStore(SERVE_STORE, null);
  if (!current) return { error: 'L’app sert déjà le checkout principal.' };
  if (syncing) return { error: 'Une bascule de l’app est déjà en cours.' };
  syncing = true;
  try {
    const cleared = await clearMainCheckout(current);
    if (cleared.error) return cleared;
    const checkout = await run('git', ['-C', REPO, 'checkout', '-q', current.previous]);
    if (!checkout.ok) return { error: checkout.stderr.trim() };
    removeStore(SERVE_STORE);
    invalidateSnapshot();
    return startApp({ restart: true });
  } finally {
    syncing = false;
  }
}

module.exports = { appState, startApp, stopApp, migrateIfPulled, serveWorktree, resyncServed, unserveWorktree, syncFrom };
