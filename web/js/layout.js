// Page layout: the workstation (attention queue on the left, the selected session in the centre) by default,
// the former card grid as a fallback picked from Outils.
let layout = localGet('layout') === 'cards' ? 'cards' : 'workstation';
let queueMin = localGet('queueMin') === '1';
let headOpen = localGet('headOpen') === '1';
let focusMode = false;

const isWorkstation = () => layout === 'workstation';

function applyLayout() {
  document.body.classList.toggle('ws', isWorkstation());
  document.body.classList.toggle('ws-queue-min', isWorkstation() && queueMin);
  document.body.classList.toggle('ws-focus', isWorkstation() && focusMode);
  const toggle = $('layout-toggle');
  if (toggle) toggle.textContent = isWorkstation() ? 'Ancienne vue en cartes' : 'Vue poste de travail';
}

function setLayout(value) {
  layout = value;
  localSet('layout', value);
  // Focus mode (f): the queue is hidden, the session takes the whole width.
function toggleFocus() {
  focusMode = !focusMode;
  applyLayout();
  toast(focusMode ? 'Mode focus : f pour revenir.' : 'Mode focus désactivé.');
}

applyLayout();
  if (state) { renderCounters(); renderGrid(); renderPanel(); }
}

function toggleQueue() {
  queueMin = !queueMin;
  localSet('queueMin', queueMin ? '1' : '0');
  applyLayout();
  renderQueue();
}

applyLayout();
