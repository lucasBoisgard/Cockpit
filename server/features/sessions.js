const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { REPO, CONFIG, CLAUDE_BIN, REVIEWS_DIR, TMUX_SIZE, TMUX_PATH } = require('../config');
const { run, git, tmux, sleep } = require('../io/exec');
const { claudeLockAlive } = require('../io/proc');
const { loadStore, saveStore, readSession, writeSessionState, readCheckpoints, sessionsIn } = require('../io/store');
const { validSha } = require('../core/git');
const { paneOf, validName, validPrRef, tmuxSessionName, reviewSystemPrompt, reviewPrompt } = require('../core/sessions');
const { usageWorktree } = require('../core/usage');
const { invalidateSnapshot } = require('../cache');
const { listWorktrees, worktreeName, livePanes, hasTranscript } = require('./worktrees');
const { cachedPr } = require('./pr');

const launchClaude = (name, cwd, args) => tmux(['new-session', '-d', '-s', name, ...TMUX_SIZE, '-c', cwd, '-e', TMUX_PATH, CLAUDE_BIN, ...args]);

function reviewSkills(wtPath) {
  if (Array.isArray(CONFIG.review?.skills)) return CONFIG.review.skills;
  const found = [path.join(wtPath, '.claude', 'skills'), path.join(os.homedir(), '.claude', 'skills')].flatMap((dir) => {
    try {
      return fs.readdirSync(dir).filter((name) => /review/i.test(name) && fs.existsSync(path.join(dir, name, 'SKILL.md')));
    } catch {
      return [];
    }
  });
  return ['code-review', 'security-review', ...found];
}

async function startSession({ worktree, prompt, kind, pr, parent }) {
  const name = String(worktree || '').trim();
  if (!validName(name)) return { error: 'Nom de worktree invalide (lettres, chiffres, . _ -).' };
  const review = kind === 'review';
  const prRef = String(pr || '').trim();
  if (review && !validPrRef(prRef)) return { error: 'PR invalide : un lien GitHub de pull request ou un numéro.' };
  const existing = (await listWorktrees()).find((wt) => worktreeName(wt.path) === name);
  const args = existing ? [] : ['--worktree', name];
  if (review) {
    fs.mkdirSync(REVIEWS_DIR, { recursive: true });
    fs.rmSync(path.join(REVIEWS_DIR, `${name}.report.json`), { force: true });
    fs.writeFileSync(path.join(REVIEWS_DIR, `${name}.json`), JSON.stringify({ kind: 'review', pr: prRef, startedAt: Date.now() }));
    const skills = [...new Set(['review-context', ...reviewSkills(existing ? existing.path : REPO), 'review-report'])];
    args.push('--append-system-prompt', reviewSystemPrompt(skills, path.join(REVIEWS_DIR, `${name}.report.json`)));
    prompt = reviewPrompt(prRef, prompt);
  }
  if (prompt && String(prompt).trim()) args.push(String(prompt));
  const session = tmuxSessionName(name, Date.now());
  const result = await launchClaude(session, existing ? existing.path : REPO, args);
  if (!result.ok) return { error: result.stderr.trim() };
  const parentSession = parent?.sessionId ? readSession(String(parent.sessionId)) : null;
  if (parentSession) {
    const links = loadStore('worktree-links.json', {});
    links[name] = { parentSessionId: parentSession.sessionId, parentWorktree: usageWorktree(parentSession.cwd, REPO), notify: !!parent.notify, createdAt: Date.now() };
    saveStore('worktree-links.json', links);
  }
  return { session };
}

async function resumeSession({ session: sessionId }) {
  const session = readSession(String(sessionId || ''));
  if (!session || !fs.existsSync(session.cwd)) return { error: 'Session inconnue.' };
  if (paneOf(session, await livePanes())) return { error: 'La session tourne déjà dans tmux.' };
  if (!hasTranscript(session)) return { error: 'Cette session n’a aucun message : rien à reprendre.' };
  const name = tmuxSessionName(path.basename(session.cwd), Date.now());
  const result = await launchClaude(name, session.cwd, ['--resume', session.sessionId]);
  return result.ok ? { session: name } : { error: result.stderr.trim() };
}

async function resumeIn(cwd, sessionId) {
  return launchClaude(tmuxSessionName(path.basename(cwd), Date.now()), cwd, ['--resume', sessionId]);
}

async function removeWorktree(wt, force) {
  const panes = await livePanes();
  for (const session of sessionsIn(wt.path)) {
    const pane = paneOf(session, panes);
    if (pane) await tmux(['kill-pane', '-t', pane]);
    writeSessionState({ ...session, status: 'ended', tmuxPane: null, updatedAt: Date.now() });
  }
  if (wt.claudeLock) {
    for (let i = 0; i < 20 && claudeLockAlive(wt.claudeLock); i++) await sleep(150);
    if (claudeLockAlive(wt.claudeLock)) return { error: `Une session Claude ouverte hors cockpit tient ce worktree (pid ${wt.claudeLock.pid}) : quitte-la (/exit) puis réessaie.` };
    await run('git', ['-C', REPO, 'worktree', 'unlock', wt.path]);
  }
  const removed = await run('git', ['-C', REPO, 'worktree', 'remove', ...(force ? ['--force'] : []), wt.path]);
  return removed.ok ? { ok: true } : { error: removed.stderr.trim() };
}

async function closeWorktree({ path: wtPath, force, deleteBranch }) {
  const wt = (await listWorktrees()).find((w) => w.path === wtPath);
  if (!wt) return { error: 'Worktree inconnu.' };
  if (wt.path === REPO) return { error: 'Le repo principal ne peut pas être fermé.' };
  if (wt.locked) return { error: 'Ce worktree est verrouillé (git worktree unlock pour le libérer).' };
  const dirty = ((await git(wt.path, ['status', '--porcelain'])) || '').trim();
  if (dirty && !force) return { error: 'Ce worktree a des changements non commités.', dirty: true };

  const removed = await removeWorktree(wt, force);
  if (removed.error) return removed;
  for (const suffix of ['.json', '.report.json']) fs.rmSync(path.join(REVIEWS_DIR, `${worktreeName(wt.path)}${suffix}`), { force: true });
  if (deleteBranch && wt.branch) {
    const branch = await run('git', ['-C', REPO, 'branch', '-d', wt.branch]);
    if (!branch.ok) return { ok: true, warning: `Worktree fermé, branche ${wt.branch} conservée : ${branch.stderr.trim()}` };
  }
  return { ok: true };
}

async function archiveWorktree({ path: wtPath }) {
  const wt = (await listWorktrees()).find((w) => w.path === wtPath);
  if (!wt) return { error: 'Worktree inconnu.' };
  if (wt.path === REPO) return { error: 'Le repo principal ne peut pas être archivé.' };
  if (wt.locked) return { error: 'Ce worktree est verrouillé.' };
  if (((await git(wt.path, ['status', '--porcelain'])) || '').trim()) return { error: 'Ce worktree a des changements non commités : commite-les avant d’archiver, ou ferme-le.' };
  const sessions = sessionsIn(wt.path).filter(hasTranscript).sort((a, b) => b.updatedAt - a.updatedAt);
  const pr = cachedPr(wt.branch);
  const entry = {
    name: worktreeName(wt.path),
    path: wt.path,
    branch: wt.branch || null,
    head: wt.head || null,
    sessions: sessions.map((s) => ({ sessionId: s.sessionId, task: s.task || null, lastAssistant: s.lastAssistant || null })),
    pr: pr ? { number: pr.number, url: pr.url, state: pr.state } : null,
    archivedAt: Date.now(),
  };
  const removed = await removeWorktree(wt, false);
  if (removed.error) return removed;
  const archives = loadStore('worktree-archive.json', []).filter((a) => a.name !== entry.name);
  saveStore('worktree-archive.json', [entry, ...archives].slice(0, 200));
  invalidateSnapshot();
  return { ok: true };
}

async function unarchiveWorktree({ name, resume }) {
  const archives = loadStore('worktree-archive.json', []);
  const entry = archives.find((a) => a.name === name);
  if (!entry) return { error: 'Archive inconnue.' };
  if (fs.existsSync(entry.path)) return { error: `${entry.path} existe déjà.` };
  const hasBranch = entry.branch && (await run('git', ['-C', REPO, 'rev-parse', '--verify', '--quiet', `refs/heads/${entry.branch}`])).ok;
  const added = await run('git', ['-C', REPO, 'worktree', 'add', ...(hasBranch ? [entry.path, entry.branch] : ['--detach', entry.path, entry.head || 'HEAD'])]);
  if (!added.ok) return { error: added.stderr.trim() };
  saveStore('worktree-archive.json', archives.filter((a) => a.name !== name));
  invalidateSnapshot();
  const last = entry.sessions?.[0];
  if (resume && last) {
    const started = await launchClaude(tmuxSessionName(entry.name, Date.now()), entry.path, ['--resume', last.sessionId]);
    if (!started.ok) return { ok: true, warning: `Worktree restauré, mais la session n’a pas pu reprendre : ${started.stderr.trim()}` };
  }
  return { ok: true, branchRestored: !!hasBranch };
}

async function restoreCheckpoint({ path: wtPath, sha }) {
  if (!validSha(sha)) return { error: 'Checkpoint invalide.' };
  const wt = (await listWorktrees()).find((w) => w.path === wtPath);
  if (!wt) return { error: 'Worktree inconnu.' };
  const known = sessionsIn(wt.path).some((s) => readCheckpoints(s.sessionId).some((c) => c.sha === sha));
  if (!known) return { error: 'Ce checkpoint n’appartient à aucune session de ce worktree.' };
  const result = await run('git', ['-C', wt.path, 'checkout', sha, '--', '.']);
  invalidateSnapshot();
  return result.ok ? { ok: true } : { error: result.stderr.trim() };
}

module.exports = { startSession, resumeSession, resumeIn, closeWorktree, archiveWorktree, unarchiveWorktree, restoreCheckpoint };
