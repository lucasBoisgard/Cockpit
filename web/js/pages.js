// Workstation pages: the tool dialogs (history, cleanup, automations, skills) open docked over the centre,
// next to the queue, without a modal backdrop, each with its own #page- address for back and forward.
const PAGE_DIALOGS = ['history-dialog', 'cleanup-dialog', 'auto-dialog', 'skills-dialog', 'mcp-dialog', 'matrix-dialog'];

function measureHeader() {
  document.body.style.setProperty('--ws-head-h', `${document.querySelector('body > header').offsetHeight}px`);
}

function openPage(dialog) {
  for (const id of PAGE_DIALOGS) if (id !== dialog.id && $(id).open) $(id).close();
  measureHeader();
  dialog.classList.add('ws-page');
  if (!dialog.open) dialog.show();
  if (location.hash !== `#page-${dialog.id}`) history.pushState(null, '', `#page-${dialog.id}`);
}

function closePages() {
  for (const id of PAGE_DIALOGS) if ($(id).open && $(id).classList.contains('ws-page')) $(id).close();
}

for (const id of PAGE_DIALOGS) {
  $(id).addEventListener('close', () => {
    $(id).classList.remove('ws-page');
    if (location.hash === `#page-${id}`) history.replaceState(null, '', location.pathname + location.search);
  });
}

window.addEventListener('hashchange', () => {
  const id = location.hash.startsWith('#page-') ? location.hash.slice(6) : null;
  if (!id) { closePages(); return; }
  const open = { 'history-dialog': openHistory, 'cleanup-dialog': openCleanup, 'auto-dialog': () => { fillAutomationForm(null); openAutomations(); }, 'skills-dialog': openSkills, 'mcp-dialog': openMcp, 'matrix-dialog': openMatrix }[id];
  if (open && !$(id).open) open();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || document.querySelector('dialog[open]:not(.ws-page)')) return;
  const page = PAGE_DIALOGS.map((id) => $(id)).find((d) => d.open && d.classList.contains('ws-page'));
  if (page && !e.target.closest?.('input, textarea, select')) { e.preventDefault(); page.close(); }
});

$('queue').addEventListener('click', (e) => { if (e.target.closest('[data-queue-path]')) closePages(); }, true);
window.addEventListener('resize', measureHeader);
