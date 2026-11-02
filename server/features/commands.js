const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { subdirs } = require('../io/files');
const { parseFrontmatter, uniqueByName } = require('../core/commands');
const { listWorktrees } = require('./worktrees');

const COMMANDS_CACHE_TTL_MS = 10000;
const commandCache = new Map();

const BUILTIN_COMMANDS = [
  ['add-dir', 'Ajouter un dossier de travail'],
  ['agents', 'Gérer les sous-agents', true],
  ['clear', "Vider l'historique de la conversation"],
  ['compact', 'Résumer la conversation pour libérer du contexte', false, '[instructions]'],
  ['config', 'Ouvrir les réglages', true],
  ['context', "Afficher l'usage du contexte"],
  ['cost', 'Afficher le coût et la durée de la session'],
  ['doctor', "Diagnostiquer l'installation"],
  ['exit', 'Quitter Claude Code'],
  ['help', "Afficher l'aide"],
  ['hooks', 'Gérer les hooks', true],
  ['init', 'Initialiser un CLAUDE.md'],
  ['mcp', 'Gérer les serveurs MCP', true],
  ['memory', 'Éditer les fichiers mémoire', true],
  ['model', 'Changer de modèle', true, '[modèle]'],
  ['permissions', 'Gérer les permissions', true],
  ['plugin', 'Gérer les plugins', true],
  ['resume', 'Reprendre une conversation', true],
  ['review', 'Relire une pull request'],
  ['rewind', 'Revenir à un point précédent', true],
  ['status', 'Afficher le statut', true],
  ['usage', "Afficher l'usage du forfait", true],
].map(([name, description, interactive = false, hint = '']) => ({ name, description, hint, interactive, source: 'builtin' }));

function frontmatter(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  return parseFrontmatter(text);
}

function skillsIn(dir, source, prefix = '') {
  return subdirs(dir).flatMap((name) => {
    const meta = frontmatter(path.join(dir, name, 'SKILL.md'));
    if (!meta || meta['user-invocable'] === 'false') return [];
    return [{ name: prefix + (meta.name || name), description: meta.description || '', hint: meta['argument-hint'] || '', source }];
  });
}

function commandsIn(dir, source, prefix = '') {
  const found = [];
  const walk = (current, parts) => {
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const full = path.join(current, e.name);
      if (e.isDirectory()) walk(full, [...parts, e.name]);
      else if (e.name.endsWith('.md')) {
        const meta = frontmatter(full) || {};
        const name = meta.name || [...parts, e.name.slice(0, -3)].join(':');
        found.push({ name: prefix + name, description: meta.description || '', hint: meta['argument-hint'] || '', source });
      }
    }
  };
  walk(dir, []);
  return found;
}

function pluginCommands() {
  let installed;
  try {
    installed = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {};
  } catch {
    return [];
  }
  return Object.entries(installed).flatMap(([id, installs]) => {
    const install = Array.isArray(installs) ? installs[0] : installs;
    if (!install?.installPath) return [];
    const prefix = `${id.split('@')[0]}:`;
    return [...skillsIn(path.join(install.installPath, 'skills'), 'plugin', prefix), ...commandsIn(path.join(install.installPath, 'commands'), 'plugin', prefix)];
  });
}

async function listCommands(wtPath) {
  if (!(await listWorktrees()).some((w) => w.path === wtPath)) return null;
  const cached = commandCache.get(wtPath);
  if (cached && Date.now() - cached.at < COMMANDS_CACHE_TTL_MS) return cached.list;
  const userDir = path.join(os.homedir(), '.claude');
  const synced = path.join(userDir, 'skills', 'synced');
  const list = uniqueByName([
    ...skillsIn(path.join(wtPath, '.claude', 'skills'), 'project'),
    ...commandsIn(path.join(wtPath, '.claude', 'commands'), 'project'),
    ...skillsIn(path.join(userDir, 'skills'), 'user'),
    ...commandsIn(path.join(userDir, 'commands'), 'user'),
    ...subdirs(synced).flatMap((bucket) => skillsIn(path.join(synced, bucket), 'synced', 'anthropic-skills:')),
    ...pluginCommands(),
    ...BUILTIN_COMMANDS,
  ]);
  commandCache.set(wtPath, { at: Date.now(), list });
  return list;
}

module.exports = { listCommands };
