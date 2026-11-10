const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const IMAGE_LIMIT_BYTES = 10 * 1024 * 1024;

function insertImagePaths(value, start, end, paths) {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const lead = !before.trim() ? (paths.length > 1 ? 'Images : ' : 'Image : ') : /\s$/.test(before) ? '' : ' ';
  const quoted = paths.map((p) => (/\s/.test(p) ? `"${p}"` : p));
  const inserted = `${lead}${quoted.join(' ')} `;
  const tail = after.startsWith(' ') ? after.slice(1) : after;
  return { value: before + inserted + tail, cursor: before.length + inserted.length };
}

function imageProblem(file) {
  if (!IMAGE_MIMES.includes(file.type)) return 'Format non pris en charge (png, jpeg, gif ou webp).';
  if (file.size > IMAGE_LIMIT_BYTES) return 'Image trop lourde (10 Mo maximum).';
  return null;
}

if (typeof module !== 'undefined') module.exports = { insertImagePaths, imageProblem, IMAGE_MIMES, IMAGE_LIMIT_BYTES };
