// Page layout: the workstation (attention queue on the left, the selected session in the centre) by default,
// the former card grid as a fallback picked from Outils.
let layout = localGet('layout') === 'cards' ? 'cards' : 'workstation';
let queueMin = localGet('queueMin') === '1';
let headOpen = localGet('headOpen') === '1';

const isWorkstation = () => layout === 'workstation';

function applyLayout() {
  document.body.classList.toggle('ws', isWorkstation());
  document.body.classList.toggle('ws-queue-min', isWorkstation() && queueMin);
  const toggle = $('layout-toggle');
  if (toggle) toggle.textContent = isWorkstation() ? 'Ancienne vue en cartes' : 'Vue poste de travail';
}

function setLayout(value) {
  layout = value;
  localSet('layout', value);
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
