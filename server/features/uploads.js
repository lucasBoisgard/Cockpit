const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { checkImage, imageFileName, staleUploads } = require('../core/uploads');

const UPLOAD_DIR = path.join(os.homedir(), '.claude', 'cockpit-uploads');

function pruneUploads(now) {
  const entries = fs.readdirSync(UPLOAD_DIR).map((name) => {
    try { return { name, mtimeMs: fs.statSync(path.join(UPLOAD_DIR, name)).mtimeMs }; } catch { return null; }
  }).filter(Boolean);
  for (const name of staleUploads(entries, now)) fs.rmSync(path.join(UPLOAD_DIR, name), { force: true });
}

function saveImage(buffer) {
  const checked = checkImage(buffer);
  if (checked.error) return checked;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });
  const now = Date.now();
  const file = path.join(UPLOAD_DIR, imageFileName(checked.ext, now, crypto.randomBytes(4).toString('hex')));
  fs.writeFileSync(file, buffer, { mode: 0o600 });
  try { pruneUploads(now); } catch {}
  return { ok: true, path: file };
}

module.exports = { saveImage, UPLOAD_DIR };
