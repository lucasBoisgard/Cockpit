const fs = require('node:fs');
const path = require('node:path');
const { git } = require('../io/exec');
const { insideRoot, parseFileList, fileContent, READ_MAX_BYTES } = require('../core/files');
const { changesTarget } = require('./changes');

const LIST_ARGS = ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];

async function listFiles(wtPath) {
  const wt = await changesTarget(wtPath);
  if (!wt) return null;
  const out = await git(wt.path, LIST_ARGS);
  return out === null ? null : parseFileList(out);
}

async function listedByGit(root, file) {
  const out = await git(root, [...LIST_ARGS, '--', `:(literal)${file}`]);
  return !!out && out.split('\0').includes(file);
}

function readHead(real, size) {
  const fd = fs.openSync(real, 'r');
  try {
    const buffer = Buffer.alloc(Math.min(size, READ_MAX_BYTES + 4));
    return buffer.subarray(0, fs.readSync(fd, buffer, 0, buffer.length, 0));
  } finally {
    fs.closeSync(fd);
  }
}

async function readFile(wtPath, file) {
  const wt = await changesTarget(wtPath);
  const full = wt && insideRoot(wt.path, file);
  if (!full || !(await listedByGit(wt.path, file))) return null;
  let real;
  try {
    real = fs.realpathSync(full);
  } catch {
    return { path: file, missing: true };
  }
  const realRoot = fs.realpathSync(wt.path);
  if (!real.startsWith(`${realRoot}/`)) return null;
  const target = path.relative(realRoot, real);
  if (target !== file && !(await listedByGit(wt.path, target))) return null;
  const stat = fs.statSync(real);
  if (!stat.isFile()) return null;
  return { path: file, ...fileContent(readHead(real, stat.size), stat.size) };
}

module.exports = { listFiles, readFile };
