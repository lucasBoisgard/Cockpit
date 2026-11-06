// Workstation top bar: what needs you as clickable pills, the terminal and token tools, search and new session.
const TOP_PULSE = [['needs', (n) => `${n} ${n > 1 ? 't’attendent' : 't’attend'}`], ['review', (n) => `${n} à relire`], ['working', (n) => `${n} en cours`]];

function renderTopbar() {
  const groups = queueGroups(queueItems());
  const count = (id) => groups.find((g) => g.id === id)?.items.length || 0;
  const pills = TOP_PULSE.filter(([id]) => count(id)).map(([id, text]) => `<button class="top-pill top-${id}" data-top-jump="${id}"><span class="top-dot"></span>${text(count(id))}</button>`).join('')
    || '<span class="top-pill top-calm"><span class="top-dot"></span>tout est calme</span>';
  const limits = limitAlerts().map((w) => `<button class="top-pill top-limit-${w.level}" data-top-path="${USAGE}" title="${esc(resetText(w))}">Limite ${esc(w.label)} : ${w.pct} %</button>`).join('');
  $('repo-title').innerHTML = `Cockpit<span class="repo" title="${esc(state.repo)}">${esc(state.repoName)}</span>`;
  setHtml($('counters'), pills + limits);
  setHtml($('topbar-tools'), `
    <button class="top-tool ${selected === SHELL ? 'is-current' : ''}" data-top-path="${SHELL}" title="Terminal bash persistant"><span class="queue-tool-dot ${state.shell?.live ? 'on' : ''}"></span>Terminal</button>
    ${usageCard()}
    <button class="top-search" data-top-palette title="Palette de commandes"><span>Chercher ou agir…</span><kbd>Ctrl K</kbd></button>`);
  $('tools-menu').querySelector('summary').textContent = '⋯';
}

$('counters').addEventListener('click', (e) => {
  const jump = e.target.closest('[data-top-jump]');
  if (jump) {
    const first = queueGroups(queueItems()).find((g) => g.id === jump.dataset.topJump)?.items[0];
    if (first) select(first.key);
    return;
  }
  const path = e.target.closest('[data-top-path]');
  if (path) select(path.dataset.topPath);
});

$('topbar-tools').addEventListener('click', (e) => {
  if (e.target.closest('[data-top-palette]')) { openPalette(); return; }
  const path = e.target.closest('[data-top-path], [data-usage]');
  if (path) select(path.dataset.usage ? USAGE : path.dataset.topPath);
});
