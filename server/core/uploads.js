const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_TTL_MS = 7 * 24 * 3600 * 1000;

const SIGNATURES = [
  { ext: 'png', mime: 'image/png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'gif', mime: 'image/gif', test: (b) => b.length > 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')) },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

function sniffImage(buffer) {
  const found = SIGNATURES.find((sig) => sig.test(buffer));
  return found ? { ext: found.ext, mime: found.mime } : null;
}

function checkImage(buffer) {
  if (!buffer.length) return { error: 'Image vide.' };
  if (buffer.length > IMAGE_MAX_BYTES) return { error: 'Image trop lourde (10 Mo maximum).' };
  const kind = sniffImage(buffer);
  return kind ? { ext: kind.ext } : { error: 'Format non pris en charge (png, jpeg, gif ou webp).' };
}

function imageFileName(ext, now, random) {
  const stamp = new Date(now).toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-');
  return `image-${stamp}-${random}.${ext}`;
}

function staleUploads(entries, now) {
  return entries.filter((e) => /^image-[\w-]+\.(png|jpg|gif|webp)$/.test(e.name) && now - e.mtimeMs > UPLOAD_TTL_MS).map((e) => e.name);
}

module.exports = { IMAGE_MAX_BYTES, UPLOAD_TTL_MS, sniffImage, checkImage, imageFileName, staleUploads };
