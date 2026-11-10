async function uploadImage(file) {
  try {
    const res = await api('/api/upload-image', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Cockpit': '1' }, body: file });
    const data = await res.json().catch(() => ({}));
    return res.ok ? { path: data.path } : { error: data.error || 'Envoi de l’image impossible.' };
  } catch {
    return { error: 'Serveur injoignable.' };
  }
}

async function attachImages(files) {
  const input = $('composer-input');
  const composer = $('composer');
  const valid = [];
  for (const file of files) {
    const problem = imageProblem(file);
    if (problem) toast(problem, 'error'); else valid.push(file);
  }
  if (!valid.length) return;
  const start = input.selectionStart;
  const end = input.selectionEnd;
  composer.classList.add('composer-uploading');
  toast(valid.length > 1 ? `Envoi de ${valid.length} images…` : 'Envoi de l’image…');
  const results = await Promise.all(valid.map(uploadImage));
  composer.classList.remove('composer-uploading');
  const paths = results.filter((r) => r.path).map((r) => r.path);
  results.filter((r) => r.error).forEach((r) => toast(r.error, 'error'));
  if (!paths.length) return;
  const from = Math.min(start, input.value.length);
  const to = Math.min(Math.max(end, from), input.value.length);
  const next = insertImagePaths(input.value, from, to, paths);
  input.value = next.value;
  input.focus();
  input.setSelectionRange(next.cursor, next.cursor);
  input.dispatchEvent(new Event('input'));
  toast(paths.length > 1 ? `${paths.length} images ajoutées` : 'Image ajoutée');
}

const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
let dragDepth = 0;

$('composer').addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  $('composer').classList.add('composer-dragover');
});
$('composer').addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
$('composer').addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) $('composer').classList.remove('composer-dragover');
});
$('composer').addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('composer').classList.remove('composer-dragover');
  if ($('composer-input').disabled) return;
  const files = [...e.dataTransfer.files];
  if (files.length) attachImages(files);
});
$('composer-input').addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length) return;
  e.preventDefault();
  attachImages(files);
});
