const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { REPO, ROOT, CLAUDE_BIN } = require('../config');
const { git } = require('../io/exec');
const { subdirs } = require('../io/files');
const { parseFrontmatter } = require('../core/commands');
const { skillTree, validateSkill, draftFrom, bodyOf } = require('../core/skills');

const USER_DIR = path.join(os.homedir(), '.claude');
const ASSIST_TIMEOUT_MS = 5 * 60 * 1000;
const TARGETS = { local: path.join(USER_DIR, 'skills'), repo: path.join(REPO, '.claude', 'skills') };
const ASSIST_PROMPT = [
  'You help the user write a Claude Code skill (a SKILL.md file) from a web page of the worktree cockpit.',
  'If the anthropic-skills:skill-creator skill is available, load it first and follow its guidance on structure, description and progressive disclosure.',
  'Read existing skills for conventions when useful: user skills are in the current directory, project skills under the added directories.',
  'Answer in the language the user writes in. Keep skills concise, imperative and written in English unless the user asks otherwise.',
  'Whenever you propose a skill or a change to the draft, give the complete SKILL.md in a single block fenced with four backticks (````markdown … ````), starting with the YAML frontmatter (name, description).',
  'Never write or edit files: the user saves the skill from the page.',
].join(' ');

const readMeta = (file) => {
  try {
    return parseFrontmatter(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

function skillsIn(dir, extra) {
  return subdirs(dir).flatMap((name) => {
    const file = path.join(dir, name, 'SKILL.md');
    const meta = readMeta(file);
    if (!meta) return [];
    const real = fs.realpathSync(path.join(dir, name));
    const source = typeof extra.source === 'function' ? extra.source(real) : extra.source;
    return [{ ...extra, source, kind: 'skill', name: (extra.prefix || '') + (meta.name || name), description: meta.description || '', path: file }];
  });
}

function commandsIn(dir, extra, parts = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {}
  return entries.flatMap((entry) => {
    if (entry.name.startsWith('.')) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return commandsIn(full, extra, [...parts, entry.name]);
    if (!entry.name.endsWith('.md')) return [];
    const meta = readMeta(full) || {};
    const name = meta.name || [...parts, entry.name.slice(0, -3)].join(':');
    return [{ ...extra, kind: 'command', name: (extra.prefix || '') + name, description: meta.description || '', namespace: [...(extra.namespace || []), ...parts], path: full }];
  });
}

async function nestedRepoSkills() {
  const files = ((await git(REPO, ['ls-files', '--', '*/.claude/skills/*/SKILL.md', '*/.claude/commands/*.md'])) || '').split('\n').filter((f) => f && !f.startsWith('.claude/'));
  const roots = [...new Set(files.map((f) => f.slice(0, f.indexOf('/.claude/'))))];
  return roots.flatMap((root) => {
    const base = path.join(REPO, root, '.claude');
    const extra = { source: 'repo', root: REPO, namespace: root.split('/') };
    return [...skillsIn(path.join(base, 'skills'), extra), ...commandsIn(path.join(base, 'commands'), extra)];
  });
}

function pluginSkills() {
  let installed = {};
  try {
    installed = JSON.parse(fs.readFileSync(path.join(USER_DIR, 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {};
  } catch {}
  return Object.entries(installed).flatMap(([id, installs]) => {
    const install = Array.isArray(installs) ? installs[0] : installs;
    if (!install?.installPath) return [];
    const extra = { source: 'plugin', plugin: id.split('@')[0], prefix: `${id.split('@')[0]}:` };
    return [...skillsIn(path.join(install.installPath, 'skills'), extra), ...commandsIn(path.join(install.installPath, 'commands'), extra)];
  });
}

async function skillEntries() {
  const synced = path.join(USER_DIR, 'skills', 'synced');
  const cockpitDirs = [path.join(ROOT, 'skills'), path.join(USER_DIR, 'worktree-dashboard', 'skills')];
  return [
    ...skillsIn(path.join(USER_DIR, 'skills'), { source: (real) => (cockpitDirs.some((dir) => real.startsWith(`${dir}/`)) ? 'cockpit' : 'local'), root: path.join(USER_DIR, 'skills') }),
    ...commandsIn(path.join(USER_DIR, 'commands'), { source: 'local' }),
    ...skillsIn(path.join(REPO, '.claude', 'skills'), { source: 'repo', root: REPO }),
    ...commandsIn(path.join(REPO, '.claude', 'commands'), { source: 'repo', root: REPO }),
    ...(await nestedRepoSkills()),
    ...subdirs(synced).flatMap((bucket) => skillsIn(path.join(synced, bucket), { source: 'synced', prefix: 'anthropic-skills:' })),
    ...pluginSkills(),
  ];
}

async function listSkills() {
  const entries = await skillEntries();
  return { tree: skillTree(entries), count: entries.length, targets: { local: TARGETS.local, repo: TARGETS.repo } };
}

async function readSkill(file) {
  const entry = (await skillEntries()).find((e) => e.path === file);
  if (!entry) return null;
  const content = fs.readFileSync(file, 'utf8');
  return { ...entry, content, body: bodyOf(content) };
}

function createSkill({ target, name, content }) {
  const dir = TARGETS[target];
  if (!dir) return { error: 'Emplacement inconnu.' };
  const checked = validateSkill(name, content);
  if (checked.error) return checked;
  const skillDir = path.join(dir, name);
  if (fs.existsSync(skillDir)) return { error: `Un skill « ${name} » existe déjà dans ${dir}.` };
  fs.mkdirSync(skillDir, { recursive: true });
  const file = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(file, String(content).endsWith('\n') ? String(content) : `${content}\n`);
  return { ok: true, path: file };
}

function assistSkill({ message, draft, sessionId }) {
  const text = String(message || '').trim();
  if (!text) return Promise.resolve({ error: 'Message vide.' });
  const resume = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(sessionId || '')) ? [`--resume=${sessionId}`] : [];
  const prompt = draft && String(draft).trim() ? `${text}\n\nCurrent draft in the editor:\n\n\`\`\`\`markdown\n${String(draft).trim()}\n\`\`\`\`` : text;
  const args = ['-p', '--output-format', 'json', '--append-system-prompt', ASSIST_PROMPT, '--tools', 'Read,Glob,Grep,Skill', '--allowedTools', 'Read Glob Grep Skill', '--add-dir', path.join(REPO, '.claude'), ...resume];
  fs.mkdirSync(TARGETS.local, { recursive: true });
  return new Promise((resolve) => {
    const child = execFile(CLAUDE_BIN, args, { cwd: TARGETS.local, timeout: ASSIST_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, COCKPIT_HIDDEN: '1' } }, (error, stdout, stderr) => {
      let out = null;
      try {
        const parsed = JSON.parse(stdout);
        out = Array.isArray(parsed) ? parsed.findLast((e) => e.type === 'result') : parsed;
      } catch {}
      if (!out || out.is_error) return resolve({ error: out?.result || (error?.killed ? "L'assistant n'a pas répondu en 5 minutes." : stderr.trim().split('\n').pop()) || "L'assistant n'a pas répondu." });
      resolve({ reply: out.result || '', draft: draftFrom(out.result), sessionId: out.session_id || null });
    });
    child.stdin.end(prompt);
  });
}

module.exports = { listSkills, readSkill, createSkill, assistSkill };
