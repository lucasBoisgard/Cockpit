function buildFileTree(paths) {
  const root = { dirs: new Map(), files: [] };
  for (const file of paths) {
    const parts = file.split('/');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      if (!node.dirs.has(part)) node.dirs.set(part, { dirs: new Map(), files: [] });
      node = node.dirs.get(part);
    }
    node.files.push(parts[parts.length - 1]);
  }
  return root;
}

function fileTreeRows(tree, open, prefix = '', depth = 0, rows = []) {
  for (const name of [...tree.dirs.keys()].sort((a, b) => a.localeCompare(b))) {
    const path = `${prefix}${name}`;
    const isOpen = open.has(path);
    rows.push({ kind: 'dir', path, name, depth, open: isOpen });
    if (isOpen) fileTreeRows(tree.dirs.get(name), open, `${path}/`, depth + 1, rows);
  }
  for (const name of [...tree.files].sort((a, b) => a.localeCompare(b))) rows.push({ kind: 'file', path: `${prefix}${name}`, name, depth });
  return rows;
}

function ancestorDirs(file) {
  const parts = file.split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

function searchFiles(paths, query, limit = 200) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored = [];
  for (const file of paths) {
    const lower = file.toLowerCase();
    if (!terms.every((t) => lower.includes(t))) continue;
    const base = lower.slice(lower.lastIndexOf('/') + 1);
    const score = terms.reduce((sum, t) => sum + (base.startsWith(t) ? 0 : base.includes(t) ? 1 : 2), 0);
    scored.push([score, file.length, file]);
  }
  scored.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]));
  return scored.slice(0, limit).map(([, , file]) => file);
}

function statusMark(code) {
  if (code === '??') return 'U';
  const worktree = String(code || '').charAt(1);
  return worktree && worktree !== '.' ? worktree : String(code || '').charAt(0);
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0).replace('.', ',')} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;
}

if (typeof module !== 'undefined') module.exports = { buildFileTree, fileTreeRows, ancestorDirs, searchFiles, statusMark, humanSize };
