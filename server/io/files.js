const fs = require('node:fs');
const path = require('node:path');

function subdirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && (e.isDirectory() || e.isSymbolicLink())).map((e) => e.name);
  } catch {
    return [];
  }
}

function jsonlFiles(dir, since, depth = 0) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {}
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return depth < 3 ? jsonlFiles(full, since, depth + 1) : [];
    if (!entry.name.endsWith('.jsonl')) return [];
    const stat = fs.statSync(full, { throwIfNoEntry: false });
    return stat && stat.mtimeMs >= since ? [{ file: full, size: stat.size }] : [];
  });
}

function readTail(file, offset, size) {
  const buffer = Buffer.alloc(size - offset);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buffer, 0, buffer.length, offset);
  } finally {
    fs.closeSync(fd);
  }
  return buffer;
}

module.exports = { subdirs, jsonlFiles, readTail };
