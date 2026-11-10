const test = require('node:test');
const assert = require('node:assert');
const { sniffImage, checkImage, imageFileName, staleUploads, IMAGE_MAX_BYTES, UPLOAD_TTL_MS } = require('../server/core/uploads');
const { insertImagePaths, imageProblem } = require('../web/js/composer-images');

const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);

test('sniffImage recognises the four formats from their bytes and rejects the rest', () => {
  assert.strictEqual(sniffImage(png).ext, 'png');
  assert.strictEqual(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])).ext, 'jpg');
  assert.strictEqual(sniffImage(Buffer.from('GIF89a....')).ext, 'gif');
  assert.strictEqual(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ')).ext, 'webp');
  assert.strictEqual(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
});

test('checkImage refuses empty, oversized and unknown content', () => {
  assert.deepStrictEqual(checkImage(png), { ext: 'png' });
  assert.match(checkImage(Buffer.alloc(0)).error, /vide/);
  assert.match(checkImage(Buffer.alloc(IMAGE_MAX_BYTES + 1)).error, /lourde/);
  assert.match(checkImage(Buffer.from('hello world, not an image')).error, /Format/);
});

test('imageFileName is built from the clock and a random suffix only', () => {
  assert.strictEqual(imageFileName('png', Date.UTC(2026, 10, 10, 9, 8, 7), 'ab12cd34'), 'image-20261110-090807-ab12cd34.png');
});

test('staleUploads only lists old image files', () => {
  const now = 10 * UPLOAD_TTL_MS;
  const entries = [
    { name: 'image-1-a.png', mtimeMs: now - UPLOAD_TTL_MS - 1 },
    { name: 'image-2-b.png', mtimeMs: now - 1000 },
    { name: 'notes.txt', mtimeMs: 0 },
  ];
  assert.deepStrictEqual(staleUploads(entries, now), ['image-1-a.png']);
});

test('insertImagePaths separates paths with spaces around the cursor', () => {
  assert.deepStrictEqual(insertImagePaths('', 0, 0, ['/a.png']), { value: '/a.png ', cursor: 7 });
  assert.deepStrictEqual(insertImagePaths('look', 4, 4, ['/a.png', '/b.png']), { value: 'look /a.png /b.png ', cursor: 19 });
  assert.deepStrictEqual(insertImagePaths('see now', 4, 4, ['/a.png']), { value: 'see /a.png now', cursor: 11 });
  assert.strictEqual(insertImagePaths('abc def', 4, 7, ['/x.png']).value, 'abc /x.png ');
});

test('imageProblem checks the type and size on the client', () => {
  assert.strictEqual(imageProblem({ type: 'image/png', size: 10 }), null);
  assert.match(imageProblem({ type: 'application/pdf', size: 10 }), /Format/);
  assert.match(imageProblem({ type: 'image/png', size: 11 * 1024 * 1024 }), /lourde/);
});
