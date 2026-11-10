const fs = require('node:fs');
const path = require('node:path');
const { REPO, PROJECTS_DIR } = require('../config');
const { run } = require('../io/exec');
const { parseHistoryMeta, searchSnippet } = require('../core/transcript');
const { usageWorktree } = require('../core/usage');
const { invalidateSnapshot } = require('../cache');
const { resumeIn } = require('./sessions');
const { CODEX_SESSIONS_DIR } = require('./providers');
const { jsonlFiles } = require('../io/files');
const { codexHistoryMeta, inRepo } = require('../core/codex-history');
const { parseCodexRollout } = require('../core/providers');

const HISTORY_FILES_MAX = 400;
const PROJECT_PREFIX = REPO.replace(/[^a-zA-Z0-9]/g, '-');
const historyIndex = new Map();

function allowedCwd(cwd) {
  if (!inRepo(cwd, REPO)) return false;
  try {
    return inRepo(fs.realpathSync(cwd), fs.realpathSync(REPO));
  } catch {
    try {
      return !fs.existsSync(cwd) && inRepo(fs.realpathSync(path.dirname(cwd)), fs.realpathSync(REPO));
    } catch { return false; }
  }
}

function historyFiles() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(PROJECTS_DIR).filter((d) => d === PROJECT_PREFIX || d.startsWith(`${PROJECT_PREFIX}-`));
  } catch {}
  const claude = dirs
    .flatMap((d) => {
      try {
        return fs.readdirSync(path.join(PROJECTS_DIR, d)).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(PROJECTS_DIR, d, f));
      } catch {
        return [];
      }
    })
    .map((file) => ({ file, stat: fs.statSync(file, { throwIfNoEntry: false }) }))
    .filter((f) => f.stat)
    .map((f) => ({ ...f, provider: 'claude' }));
  const codex = jsonlFiles(CODEX_SESSIONS_DIR, 0).map(({ file }) => ({ file, stat: fs.statSync(file, { throwIfNoEntry: false }), provider: 'codex' })).filter((f) => f.stat);
  return [...claude, ...codex].sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).filter((f) => allowedCwd(historyMeta(f)?.cwd)).slice(0, HISTORY_FILES_MAX);
}

function historyMeta({ file, stat, provider }) {
  const cached = historyIndex.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.meta;
  const text = fs.readFileSync(file, 'utf8');
  const meta = provider === 'codex' ? codexHistoryMeta(text, file, stat.mtimeMs) : parseHistoryMeta(text, { sessionId: path.basename(file, '.jsonl'), file, mtimeMs: stat.mtimeMs });
  if (!meta) return null;
  const result = { ...meta, worktree: usageWorktree(meta.cwd, REPO), exists: !!meta.cwd && fs.existsSync(meta.cwd) };
  historyIndex.set(file, { mtimeMs: stat.mtimeMs, meta: result });
  return result;
}

function searchHistory(query, limit = 80) {
  const q = String(query || '').trim().toLowerCase();
  const out = [];
  for (const f of historyFiles()) {
    const meta = historyMeta(f);
    if (!meta?.messages) continue;
    if (!q) {
      out.push(meta);
    } else {
      const text = fs.readFileSync(f.file, 'utf8');
      const index = text.toLowerCase().indexOf(q);
      if (index < 0 && !meta.files.some((p) => p.toLowerCase().includes(q))) continue;
      out.push({ ...meta, snippet: searchSnippet(text, index, q.length) });
    }
    if (out.length >= limit) break;
  }
  return out;
}

function historyFile(sessionId) {
  return historyFiles().find((f) => {
    const meta = historyMeta(f);
    return meta?.sessionId === sessionId && allowedCwd(meta.cwd);
  }) || null;
}

function historyChat(found, sessionId) {
  return found.provider === 'codex' ? parseCodexRollout(fs.readFileSync(found.file, 'utf8'), sessionId) : require('./chat').readChatFile(found.file, sessionId);
}

async function resumeFromHistory({ session: sessionId }) {
  if (!/^[\w-]+$/.test(String(sessionId || ''))) return { error: 'Session invalide.' };
  const found = historyFile(sessionId);
  if (!found) return { error: 'Session introuvable.' };
  const meta = historyMeta(found);
  if (!allowedCwd(meta?.cwd)) return { error: 'Dossier de la session inconnu.' };
  if (!fs.existsSync(meta.cwd)) {
    const inWorktrees = meta.cwd.startsWith(`${REPO}/.claude/worktrees/`);
    const hasBranch = meta.branch && (await run('git', ['-C', REPO, 'rev-parse', '--verify', '--quiet', `refs/heads/${meta.branch}`])).ok;
    if (!inWorktrees || !hasBranch) return { error: `Le dossier ${meta.cwd} n’existe plus et sa branche est introuvable.` };
    const added = await run('git', ['-C', REPO, 'worktree', 'add', meta.cwd, meta.branch]);
    if (!added.ok) return { error: added.stderr.trim() };
  }
  const result = await resumeIn(meta.cwd, sessionId, found.provider);
  invalidateSnapshot();
  return result.ok ? { ok: true, worktree: usageWorktree(meta.cwd, REPO) } : { error: result.stderr.trim() };
}

module.exports = { searchHistory, historyFile, historyChat, resumeFromHistory };
