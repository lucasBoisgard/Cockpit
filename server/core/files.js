const path = require('node:path');

const FILES_MAX = 50000;
const READ_MAX_BYTES = 512 * 1024;

function insideRoot(root, file) {
  if (!file || typeof file !== 'string' || file.includes('\0') || path.isAbsolute(file)) return null;
  const full = path.resolve(root, file);
  return full.startsWith(`${root}/`) ? full : null;
}

function parseFileList(out, max = FILES_MAX) {
  const seen = new Set();
  for (const file of String(out || '').split('\0')) if (file) seen.add(file);
  const files = [...seen].sort();
  return { files: files.slice(0, max), truncated: files.length > max };
}

const looksBinary = (buffer) => buffer.subarray(0, 8000).includes(0);

function fileContent(buffer, size, max = READ_MAX_BYTES) {
  if (looksBinary(buffer)) return { binary: true, size };
  const truncated = size > max;
  let content = buffer.subarray(0, max).toString('utf8');
  if (truncated) content = content.replace(/�+$/, '');
  return { binary: false, size, truncated, content };
}

module.exports = { FILES_MAX, READ_MAX_BYTES, insideRoot, parseFileList, looksBinary, fileContent };
