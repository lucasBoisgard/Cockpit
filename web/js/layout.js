// Page layout: the attention queue on the left, the selected session in the centre.
let queueMin = localGet('queueMin') === '1';
let headOpen = localGet('headOpen') === '1';
let focusMode = false;

function applyLayout() {
  document.body.classList.toggle('ws-queue-min', queueMin);
  document.body.classList.toggle('ws-focus', focusMode);
}

// Focus mode (f): the queue is hidden, the session takes the whole width.
function toggleFocus() {
  focusMode = !focusMode;
  applyLayout();
  toast(focusMode ? 'Mode focus : f pour revenir.' : 'Mode focus désactivé.');
}

function toggleQueue() {
  queueMin = !queueMin;
  localSet('queueMin', queueMin ? '1' : '0');
  applyLayout();
  renderQueue();
}

applyLayout();
