const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawn } = require('node:child_process');
const { ROOT, STARTED_AT, TOKEN_FILE, ALLOWED_HOSTS } = require('./config');
const { sleep } = require('./io/exec');
const { readSession } = require('./io/store');
const { invalidateSnapshot } = require('./cache');
const { snapshot, cleanupList } = require('./features/snapshot');
const { markEventsRead, recentEvents } = require('./features/events');
const { enqueue, dequeue, deliver, broadcast } = require('./features/queue');
const { resolveTarget, pasteText, submitText, sendOps, screen, screenHash } = require('./features/terminal');
const { startSession, resumeSession, closeWorktree, archiveWorktree, unarchiveWorktree, restoreCheckpoint } = require('./features/sessions');
const { appState, startApp, stopApp, serveWorktree, unserveWorktree } = require('./features/app');
const { prDetails, sendCheckFailure, pushBranch, prDraft, createPr } = require('./features/pr');
const { changesSince, ticketCommits, diff } = require('./features/changes');
const { searchHistory, historyFile, resumeFromHistory } = require('./features/history');
const { readChat, readChatFile } = require('./features/chat');
const { agentsOf } = require('./features/agents');
const { usageHistory } = require('./features/usage');
const { listCommands } = require('./features/commands');
const { saveAutomation, deleteAutomation, listAutomations, runAutomation } = require('./features/automations');

const BODY_MAX_BYTES = 1024 * 1024;
const ASSET_TYPES = { '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const OFFLINE_ERROR = 'Cette session ne tourne pas dans tmux, le cockpit ne peut pas lui écrire.';

function readToken() {
  try {
    const token = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (token.length >= 32) return Buffer.from(token);
  } catch {}
  console.error(`Missing or invalid ${TOKEN_FILE}: run start.sh to generate it.`);
  process.exit(1);
}

const TOKEN = readToken();

function allowedHost(req) {
  try {
    return ALLOWED_HOSTS.has(new URL(`http://${req.headers.host}`).hostname.toLowerCase());
  } catch {
    return false;
  }
}

function authorized(req) {
  const given = Buffer.from(String(req.headers['x-cockpit-token'] || ''));
  return given.length === TOKEN.length && crypto.timingSafeEqual(given, TOKEN);
}

function allowedWrite(req) {
  if (req.method !== 'POST' || req.headers['x-cockpit'] !== '1') return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_MAX_BYTES) reject(new Error('body too large'));
      else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function send(res, status, type, body, extraHeaders = {}) {
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', Vary: 'Accept-Encoding', ...extraHeaders };
  if (body && Buffer.byteLength(body) > 2048 && /\bgzip\b/.test(res.req?.headers['accept-encoding'] || '')) {
    headers['Content-Encoding'] = 'gzip';
    body = zlib.gzipSync(body, { level: 4 });
  }
  res.writeHead(status, headers);
  res.end(body);
}

const json = (res, status, data) => send(res, status, 'application/json', JSON.stringify(data));

function loadAssets(dir, prefix = '/web') {
  const assets = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) for (const [key, value] of loadAssets(full, `${prefix}/${entry.name}`)) assets.set(key, value);
    else if (ASSET_TYPES[path.extname(entry.name)]) assets.set(`${prefix}/${entry.name}`, { type: ASSET_TYPES[path.extname(entry.name)], body: fs.readFileSync(full, 'utf8') });
  }
  return assets;
}

const page = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const assets = fs.existsSync(path.join(ROOT, 'web')) ? loadAssets(path.join(ROOT, 'web')) : new Map();

const writeActions = {
  '/api/events/read': (body) => markEventsRead(body),
  '/api/queue/remove': (body) => dequeue(String(body.target || ''), String(body.id || '')),
  '/api/broadcast': (body) => broadcast(body),
  '/api/checks/send': (body) => sendCheckFailure(body),
  '/api/push': (body) => pushBranch(body),
  '/api/pr': (body) => createPr(body),
  '/api/archive': (body) => archiveWorktree(body),
  '/api/unarchive': (body) => unarchiveWorktree(body),
  '/api/app/serve': (body) => serveWorktree(body),
  '/api/app/unserve': () => unserveWorktree(),
  '/api/restore': (body) => restoreCheckpoint(body),
  '/api/history/resume': (body) => resumeFromHistory(body),
  '/api/automations/save': (body) => saveAutomation(body),
  '/api/automations/delete': (body) => deleteAutomation(body),
  '/api/automations/run': (body) => runAutomation(String(body.id || '')),
};

const terminalActions = {
  '/api/send': async (res, target, body) => {
    await submitText(target, String(body.text || ''));
    return json(res, 200, { ok: true });
  },
  '/api/paste': async (res, target, body) => {
    await pasteText(target, String(body.text || ''));
    return json(res, 200, { ok: true });
  },
  '/api/keys': async (res, target, body) => {
    await sendOps(target, Array.isArray(body.ops) ? body.ops.slice(0, 200) : []);
    if (!body.withScreen) return json(res, 200, { ok: true });
    await sleep(40);
    const text = await screen(target);
    const hash = text === null ? null : screenHash(text);
    return json(res, 200, { ok: true, hash, screen: hash && hash !== body.hash ? text : null });
  },
};

async function handleWrite(req, res, route) {
  if (!allowedWrite(req)) return json(res, 403, { error: 'Requête refusée.' });
  const body = await readBody(req);
  invalidateSnapshot();
  if (route === '/api/restart') {
    json(res, 200, { ok: true, startedAt: STARTED_AT });
    setTimeout(() => spawn(path.join(ROOT, 'start.sh'), { detached: true, stdio: 'ignore' }).unref(), 200);
    return;
  }
  if (route === '/api/start') {
    const result = await startSession(body);
    return json(res, result.error ? 400 : 200, result);
  }
  if (route === '/api/resume') {
    const result = await resumeSession(body);
    return json(res, result.error ? 400 : 200, result);
  }
  if (route === '/api/app/start' || route === '/api/app/stop') {
    const result = route === '/api/app/start' ? await startApp(body) : await stopApp();
    return json(res, result.error ? 409 : 200, result);
  }
  if (route === '/api/close') {
    const result = await closeWorktree(body);
    return json(res, result.error ? (result.dirty ? 409 : 400) : 200, result);
  }
  if (writeActions[route]) {
    const result = await writeActions[route](body);
    invalidateSnapshot();
    return json(res, result?.error ? 400 : 200, result);
  }
  if (route === '/api/queue') {
    const session = readSession(String(body.target || ''));
    if (!session || !String(body.text || '').trim()) return json(res, 400, { error: 'Session ou message manquant.' });
    return json(res, 200, enqueue(session.sessionId, String(body.text).trim()));
  }
  if (route === '/api/deliver') {
    const outcome = await deliver(body.target, String(body.text || '').trim());
    return json(res, ['sent', 'queued'].includes(outcome) ? 200 : 409, outcome === 'sent' || outcome === 'queued' ? { ok: true, outcome } : { error: OFFLINE_ERROR });
  }
  const target = await resolveTarget(body.target);
  if (!target) return json(res, 409, { error: OFFLINE_ERROR });
  if (terminalActions[route]) return terminalActions[route](res, target, body);
  return json(res, 404, { error: 'not found' });
}

function orBadRequest(res, value, message) {
  return value === null ? json(res, 400, { error: message }) : json(res, 200, value);
}

const readRoutes = {
  '/api/events': (res) => json(res, 200, recentEvents()),
  '/api/changes': async (res, q) => orBadRequest(res, await changesSince(q.get('wt') || '', q.get('since') || ''), 'Checkpoint ou worktree invalide.'),
  '/api/commits': async (res, q) => orBadRequest(res, await ticketCommits(q.get('wt') || ''), 'Base de la branche introuvable.'),
  '/api/checks': async (res, q) => orBadRequest(res, await prDetails(q.get('wt') || ''), 'Worktree sans branche, ou gh absent.'),
  '/api/pr-draft': async (res, q) => orBadRequest(res, await prDraft(q.get('wt') || ''), 'Worktree sans branche.'),
  '/api/cleanup': async (res) => json(res, 200, await cleanupList()),
  '/api/history': (res, q) => json(res, 200, searchHistory(q.get('q') || '')),
  '/api/history/chat': (res, q) => {
    const sessionId = q.get('session') || '';
    const found = /^[\w-]+$/.test(sessionId) ? historyFile(sessionId) : null;
    return found ? json(res, 200, readChatFile(found.file, sessionId)) : send(res, 404, 'text/plain', 'session not found');
  },
  '/api/automations': (res) => json(res, 200, listAutomations()),
  '/api/state': async (res) => json(res, 200, { ...(await snapshot()), startedAt: STARTED_AT }),
  '/api/app': async (res) => json(res, 200, await appState()),
  '/api/usage': (res, q) => json(res, 200, usageHistory(Number(q.get('tz')))),
  '/api/chat': (res, q) => {
    const chat = readChat(q.get('session') || '');
    return chat === null ? send(res, 404, 'text/plain', 'transcript not found') : json(res, 200, chat);
  },
  '/api/agents': (res, q) => {
    const agents = agentsOf(q.get('session') || '');
    return agents === null ? send(res, 404, 'text/plain', 'transcript not found') : json(res, 200, agents);
  },
  '/api/screen': async (res, q) => {
    const target = await resolveTarget(q.get('target'));
    const text = target ? await screen(target) : null;
    if (text === null) return send(res, 409, 'text/plain', 'no tmux pane');
    const hash = screenHash(text);
    return hash === q.get('hash') ? send(res, 204, 'text/plain', '', { 'X-Screen-Hash': hash }) : send(res, 200, 'text/plain; charset=utf-8', text, { 'X-Screen-Hash': hash });
  },
  '/api/commands': async (res, q) => {
    const list = await listCommands(q.get('path') || '');
    return list === null ? send(res, 400, 'text/plain', 'unknown worktree') : json(res, 200, list);
  },
  '/api/diff': async (res, q) => {
    const result = await diff(q.get('wt') || '', q.get('file') || '', q.get('since') || '');
    return result === null ? send(res, 400, 'text/plain', 'invalid path') : send(res, 200, 'text/plain; charset=utf-8', result);
  },
};

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (!allowedHost(req)) return send(res, 421, 'text/plain', 'Host not allowed. Add it to COCKPIT_HOSTS.');
    if (url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', page);
    if (assets.has(url.pathname)) return send(res, 200, assets.get(url.pathname).type, assets.get(url.pathname).body);
    if (!authorized(req)) return json(res, 401, { error: 'Token manquant ou invalide.' });
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) return await handleWrite(req, res, url.pathname);
    if (Object.hasOwn(readRoutes, url.pathname)) return await readRoutes[url.pathname](res, url.searchParams);
    send(res, 404, 'text/plain', 'not found');
  } catch (error) {
    send(res, 500, 'text/plain', String(error));
  }
}

const createServer = () => http.createServer(handle);

module.exports = { createServer };
