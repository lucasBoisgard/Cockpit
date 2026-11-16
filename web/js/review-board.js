// Review board pills in the top bar: pull requests waiting for a review, and the user's own pull requests that need an answer.
const BOARD_LISTS = {
  toReview: { cls: 'board-pill-review', text: (n) => `${n} PR à reviewer` },
  mine: { cls: 'board-pill-mine', text: (n) => `${n} de tes PR à reprendre` },
};

function boardPills() {
  const board = state.reviewBoard;
  if (!board) return '';
  const stale = board.error ? ` title="Données du ${esc(new Date(board.at).toLocaleTimeString())} · ${esc(board.error)}"` : '';
  if (board.error && !board.at) return `<a class="top-pill board-pill-error" href="${esc(board.url)}" target="_blank" rel="noopener" title="${esc(board.error)}">Board review indisponible</a>`;
  return Object.entries(BOARD_LISTS)
    .filter(([key]) => board[key]?.length)
    .map(([key, list]) => `<button class="top-pill ${list.cls} ${board.error ? 'board-stale' : ''}" data-board-list="${key}" aria-haspopup="true"${stale}><span class="top-dot"></span>${list.text(board[key].length)}</button>`)
    .join('');
}

function boardRowHtml(pr, key) {
  const meta = key === 'mine' ? pr.status : `par ${pr.author || '?'}${pr.owner ? ` · owner ${pr.owner}` : ''}`;
  const body = `<span class="board-num">#${esc(String(pr.number))}</span><span class="board-title" title="${esc(pr.title)}">${esc(pr.title)}</span><span class="board-meta">${esc(meta || '')}</span>`;
  return `<li>${pr.url ? `<a class="board-row" href="${esc(pr.url)}" target="_blank" rel="noopener">${body}</a>` : `<div class="board-row">${body}</div>`}</li>`;
}

function closeBoardPop() {
  $('board-pop')?.remove();
}

function boardPopHtml(key) {
  const board = state.reviewBoard;
  const items = board?.[key] || [];
  return `<div class="board-head"><b>${esc(BOARD_LISTS[key].text(items.length))}</b><a href="${esc(board.url)}" target="_blank" rel="noopener">Ouvrir le board</a></div><ul class="board-list">${items.map((pr) => boardRowHtml(pr, key)).join('')}</ul>`;
}

// Called after each top bar render: the open list follows the data and closes with its pill.
function syncBoardPop() {
  const pop = $('board-pop');
  if (!pop) return;
  if (!document.querySelector(`[data-board-list="${pop.dataset.list}"]`)) closeBoardPop();
  else setHtml(pop, boardPopHtml(pop.dataset.list));
}

function openBoardPop(button, key) {
  const already = $('board-pop')?.dataset.list === key;
  closeBoardPop();
  if (already) return;
  const pop = document.createElement('div');
  pop.id = 'board-pop';
  pop.className = 'board-pop';
  pop.dataset.list = key;
  pop.setAttribute('role', 'dialog');
  setHtml(pop, boardPopHtml(key));
  document.body.appendChild(pop);
  const rect = button.getBoundingClientRect();
  pop.style.top = `${rect.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - pop.offsetWidth - 8))}px`;
}

$('counters').addEventListener('click', (e) => {
  const pill = e.target.closest('[data-board-list]');
  if (pill) openBoardPop(pill, pill.dataset.boardList);
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('#board-pop, [data-board-list]')) closeBoardPop();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeBoardPop();
});
