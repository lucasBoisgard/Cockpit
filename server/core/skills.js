const { parseFrontmatter } = require('./commands');

const SOURCE_ORDER = ['local', 'cockpit', 'repo', 'codexLocal', 'codexRepo', 'codexLegacy', 'synced', 'plugin'];
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function skillTree(entries) {
  const sources = new Map();
  for (const entry of entries) {
    const key = entry.plugin ? `plugin:${entry.plugin}` : entry.source;
    if (!sources.has(key)) sources.set(key, { id: key, source: entry.source, plugin: entry.plugin || null, root: entry.root || null, folders: new Map(), items: [] });
    const group = sources.get(key);
    let folder = group;
    for (const part of entry.namespace || []) {
      if (!folder.folders.has(part)) folder.folders.set(part, { name: part, folders: new Map(), items: [] });
      folder = folder.folders.get(part);
    }
    folder.items.push({ name: entry.name, kind: entry.kind, description: entry.description || '', path: entry.path });
  }
  const finish = (folder) => ({
    ...folder,
    folders: [...folder.folders.values()].sort((a, b) => a.name.localeCompare(b.name)).map(finish),
    items: folder.items.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
  });
  const rank = (group) => SOURCE_ORDER.indexOf(group.source);
  return [...sources.values()].sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id)).map(finish);
}

function validateSkill(name, content) {
  if (!NAME_PATTERN.test(String(name || ''))) return { error: 'Nom invalide : minuscules, chiffres et tirets, 64 caractères au plus.' };
  const text = String(content || '');
  if (!/^---\r?\n[\s\S]*?\r?\n---/.test(text)) return { error: 'Le SKILL.md doit commencer par un en-tête YAML entre deux lignes ---.' };
  const meta = parseFrontmatter(text);
  if (!meta.description) return { error: "L'en-tête doit contenir une description : elle indique quand charger le skill." };
  if (meta.name && meta.name !== name) return { error: `Le nom de l'en-tête (${meta.name}) ne correspond pas au nom du skill (${name}).` };
  if (!text.replace(/^---[\s\S]*?\n---/, '').trim()) return { error: "Le skill n'a pas de contenu sous l'en-tête." };
  return { meta };
}

function draftFrom(text) {
  const blocks = [...String(text || '').matchAll(/^(`{4,}|~{3,})[\w-]*[^\S\n]*\n([\s\S]*?)\n\1[^\S\n]*$/gm)].map((m) => m[2]);
  return blocks.reverse().find((block) => /^---\r?\n[\s\S]*?\r?\n---/.test(block)) || null;
}

function bodyOf(text) {
  return String(text || '').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
}

module.exports = { skillTree, validateSkill, draftFrom, bodyOf };
