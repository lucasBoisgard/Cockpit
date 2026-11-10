const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { REPO, CONFIG, CLAUDE_BIN, REVIEWS_DIR, TMUX_SIZE, TMUX_PATH } = require('../config');
const { run, git, tmux, sleep } = require('../io/exec');
const { claudeLockAlive } = require('../io/proc');
const { loadStore, saveStore, readSession, writeSessionOverride, sessionsIn } = require('../io/store');
const { paneOf, validName, validPrRef, tmuxSessionName, reviewSystemPrompt, reviewPrompt } = require('../core/sessions');
const { usageWorktree } = require('../core/usage');
const { invalidateSnapshot } = require('../cache');
const { listWorktrees, worktreeName, isMainCheckout, livePanes, hasTranscript } = require('./worktrees');
const { cachedPr } = require('./pr');
const providerCore = require('../core/providers');
const { binOf, codexHookCommand, codexInfo, codexCatalog } = require('./providers');
const { registerCodexLaunch } = require('./codex-screens');

// COCKPIT_ASK marks a session launched by the cockpit: its questions are answered in the conversation.
const launchProcess = (name, cwd, bin, args, env = []) => tmux(['new-session', '-d', '-s', name, ...TMUX_SIZE, '-c', cwd, '-e', TMUX_PATH, '-e', 'COCKPIT_ASK=1', ...env.flatMap((e) => ['-e', e]), bin, ...args]);
// Every Claude session the cockpit launches or resumes gets the ask-relay hook, so its questions are
// answered in the conversation; nothing is installed in ~/.claude/settings.json for it.
const ASK_SETTINGS = JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: `node ${path.join(__dirname, '..', '..', 'hooks', 'ask-relay.js')}`, timeout: 1800 }] }] } });
const launchClaude = (name, cwd, args, env = []) => launchProcess(name, cwd, CLAUDE_BIN, ['--settings', ASK_SETTINGS, ...args], env);

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

// A worktree for a provider that cannot create one itself, where Claude Code would have put it.
async function addWorktree(name) {
  const dir = path.join(REPO, '.claude', 'worktrees', name);
  if (fs.existsSync(dir)) return { error: `${dir} existe déjà.` };
  const branch = `worktree-${name}`;
  const exists = (await run('git', ['-C', REPO, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`])).ok;
  const added = await run('git', ['-C', REPO, 'worktree', 'add', ...(exists ? [dir, branch] : ['-b', branch, dir, 'HEAD'])]);
  return added.ok ? { path: dir } : { error: added.stderr.trim() };
}

async function startCodexSession({ name, existing, prompt, model, effort, mode, parent }) {
  const info = await codexInfo();
  if (!info.installed) return { error: 'Codex CLI n’est pas installé (npm install -g @openai/codex).' };
  if (!info.loggedIn) return { error: 'Codex n’est pas connecté : lance « codex login » dans un terminal.' };
  const settings = providerCore.validateSettings('codex', { model, effort, mode }, await codexCatalog());
  if (settings.error) return settings;
  const target = existing ? { path: existing.path } : await addWorktree(name);
  if (target.error) return target;
  const session = tmuxSessionName(name, Date.now());
  const launch = { model: settings.model, effort: settings.effort, mode: settings.mode || 'acceptEdits' };
  const args = providerCore.launchArgs('codex', { hookCommand: codexHookCommand(), ...launch, prompt: String(prompt || '').trim() });
  const result = await launchProcess(session, target.path, binOf('codex'), args, [`COCKPIT_LAUNCH=${JSON.stringify({ provider: 'codex', ...launch })}`]);
  if (!result.ok) return { error: result.stderr.trim() };
  registerCodexLaunch(session, target.path);
  linkParent(name, parent);
  return { session };
}

function linkParent(name, parent) {
  const parentSession = parent?.sessionId ? readSession(String(parent.sessionId)) : null;
  if (!parentSession) return;
  const links = loadStore('worktree-links.json', {});
  links[name] = { parentSessionId: parentSession.sessionId, parentWorktree: usageWorktree(parentSession.cwd, REPO), notify: !!parent.notify, createdAt: Date.now() };
  saveStore('worktree-links.json', links);
}

async function startSession({ worktree, prompt, kind, pr, parent, provider, model, effort, mode }) {
  const name = String(worktree || '').trim();
  if (!validName(name)) return { error: 'Nom de worktree invalide (lettres, chiffres, . _ -).' };
  if (provider === 'codex') {
    if (kind === 'review') return { error: 'Les reviews tournent avec Claude.' };
    const found = (await listWorktrees()).find((wt) => worktreeName(wt.path) === name);
    return startCodexSession({ name, existing: found, prompt, model, effort, mode, parent });
  }
  const chosen = model || effort || mode ? providerCore.validateSettings('claude', { model, effort, mode }) : {};
  if (chosen.error) return chosen;
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
  if (chosen.model) args.push('--model', chosen.model);
  if (chosen.effort) args.push('--effort', chosen.effort);
  if (chosen.mode && chosen.mode !== 'default') args.push('--permission-mode', chosen.mode);
  if (prompt && String(prompt).trim()) args.push(String(prompt));
  const session = tmuxSessionName(name, Date.now());
  const result = await launchClaude(session, existing ? existing.path : REPO, args);
  if (!result.ok) return { error: result.stderr.trim() };
  linkParent(name, parent);
  return { session };
}

async function resumeSession({ session: sessionId }) {
  const session = readSession(String(sessionId || ''));
  if (!session || !fs.existsSync(session.cwd)) return { error: 'Session inconnue.' };
  if (paneOf(session, await livePanes())) return { error: 'La session tourne déjà dans tmux.' };
  if (!hasTranscript(session)) return { error: 'Cette session n’a aucun message : rien à reprendre.' };
  const name = tmuxSessionName(path.basename(session.cwd), Date.now());
  const result = await resumeProcess(name, session.cwd, session.sessionId);
  return result.ok ? { session: name } : { error: result.stderr.trim() };
}

// Resumes a session with its own provider. A Codex session gets back the settings it was launched with;
// when they are unknown it comes back read-only rather than with more rights than it had.
function resumeProcess(name, cwd, sessionId) {
  const session = readSession(sessionId);
  if (session?.provider !== 'codex') {
    const disallow = require('./orchestration').masterResumeDisallowed(sessionId);
    return launchClaude(name, cwd, [...(disallow.length ? ['--disallowedTools', ...disallow] : []), '--resume', sessionId]);
  }
  const launch = session.launch || { mode: 'plan' };
  const args = providerCore.launchArgs('codex', { resume: true, sessionId, hookCommand: codexHookCommand(), model: launch.model, effort: launch.effort, mode: launch.mode || 'plan' });
  registerCodexLaunch(name, cwd);
  return launchProcess(name, cwd, binOf('codex'), args, [`COCKPIT_LAUNCH=${JSON.stringify({ provider: 'codex', ...launch })}`]);
}

async function resumeIn(cwd, sessionId) {
  return resumeProcess(tmuxSessionName(path.basename(cwd), Date.now()), cwd, sessionId);
}

async function removeWorktree(wt, force) {
  const panes = await livePanes();
  for (const session of sessionsIn(wt.path)) {
    const pane = paneOf(session, panes);
    if (pane) await tmux(['kill-pane', '-t', pane]);
    writeSessionOverride(session.sessionId, { status: 'ended', tmuxPane: null, updatedAt: Date.now() });
  }
  if (wt.claudeLock) {
    for (let i = 0; i < 20 && claudeLockAlive(wt.claudeLock); i++) await sleep(150);
    if (claudeLockAlive(wt.claudeLock)) return { error: `Une session Claude ouverte hors cockpit tient ce worktree (pid ${wt.claudeLock.pid}) : quitte-la (/exit) puis réessaie.` };
    await run('git', ['-C', wt.repo || REPO, 'worktree', 'unlock', wt.path]);
  }
  const removed = await run('git', ['-C', wt.repo || REPO, 'worktree', 'remove', ...(force ? ['--force'] : []), wt.path]);
  return removed.ok ? { ok: true } : { error: removed.stderr.trim() };
}

async function closeWorktree({ path: wtPath, force, deleteBranch }) {
  const wt = (await listWorktrees()).find((w) => w.path === wtPath);
  if (!wt) return { error: 'Worktree inconnu.' };
  if (isMainCheckout(wt)) return { error: 'Un checkout principal ne peut pas être fermé.' };
  if (wt.locked) return { error: 'Ce worktree est verrouillé (git worktree unlock pour le libérer).' };
  const dirty = ((await git(wt.path, ['status', '--porcelain'])) || '').trim();
  if (dirty && !force) return { error: 'Ce worktree a des changements non commités.', dirty: true };

  const removed = await removeWorktree(wt, force);
  if (removed.error) return removed;
  for (const suffix of ['.json', '.report.json']) fs.rmSync(path.join(REVIEWS_DIR, `${worktreeName(wt.path)}${suffix}`), { force: true });
  if (deleteBranch && wt.branch) {
    const branch = await run('git', ['-C', wt.repo || REPO, 'branch', '-d', wt.branch]);
    if (!branch.ok) return { ok: true, warning: `Worktree fermé, branche ${wt.branch} conservée : ${branch.stderr.trim()}` };
  }
  return { ok: true };
}

async function archiveWorktree({ path: wtPath }) {
  const wt = (await listWorktrees()).find((w) => w.path === wtPath);
  if (!wt) return { error: 'Worktree inconnu.' };
  if (isMainCheckout(wt)) return { error: 'Un checkout principal ne peut pas être archivé.' };
  if (wt.locked) return { error: 'Ce worktree est verrouillé.' };
  if (((await git(wt.path, ['status', '--porcelain'])) || '').trim()) return { error: 'Ce worktree a des changements non commités : commite-les avant d’archiver, ou ferme-le.' };
  const sessions = sessionsIn(wt.path).filter(hasTranscript).sort((a, b) => b.updatedAt - a.updatedAt);
  const pr = cachedPr(wt.branch, wt.repo);
  const entry = {
    name: worktreeName(wt.path),
    path: wt.path,
    repo: wt.repo || REPO,
    branch: wt.branch || null,
    head: wt.head || null,
    sessions: sessions.map((s) => ({ sessionId: s.sessionId, task: s.task || null, lastAssistant: s.lastAssistant || null })),
    pr: pr ? { number: pr.number, url: pr.url, state: pr.state } : null,
    archivedAt: Date.now(),
  };
  const removed = await removeWorktree(wt, false);
  if (removed.error) return removed;
  const archives = loadStore('worktree-archive.json', []).filter((a) => a.path !== entry.path);
  saveStore('worktree-archive.json', [entry, ...archives].slice(0, 200));
  invalidateSnapshot();
  return { ok: true };
}

async function unarchiveWorktree({ path: archivedPath, name, resume }) {
  const archives = loadStore('worktree-archive.json', []);
  const entry = archives.find((a) => (archivedPath ? a.path === archivedPath : a.name === name));
  if (!entry) return { error: 'Archive inconnue.' };
  if (fs.existsSync(entry.path)) return { error: `${entry.path} existe déjà.` };
  const repo = entry.repo || REPO;
  const hasBranch = entry.branch && (await run('git', ['-C', repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${entry.branch}`])).ok;
  const added = await run('git', ['-C', repo, 'worktree', 'add', ...(hasBranch ? [entry.path, entry.branch] : ['--detach', entry.path, entry.head || 'HEAD'])]);
  if (!added.ok) return { error: added.stderr.trim() };
  saveStore('worktree-archive.json', archives.filter((a) => a !== entry));
  invalidateSnapshot();
  const last = entry.sessions?.[0];
  if (resume && last) {
    const started = await resumeProcess(tmuxSessionName(entry.name, Date.now()), entry.path, last.sessionId);
    if (!started.ok) return { ok: true, warning: `Worktree restauré, mais la session n’a pas pu reprendre : ${started.stderr.trim()}` };
  }
  return { ok: true, branchRestored: !!hasBranch };
}

module.exports = { launchProcess, launchClaude, startSession, resumeSession, resumeIn, closeWorktree, archiveWorktree, unarchiveWorktree };
