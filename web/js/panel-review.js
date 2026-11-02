const KINDS = {
  blocking: { label: 'Bloquant · request changes', group: 'Bloquants', short: 'bloquant' },
  fix: { label: 'À corriger', group: 'À corriger', short: 'à corriger' },
  suggestion: { label: 'Suggestion', group: 'Suggestions', short: 'suggestion' },
  question: { label: 'Question', group: 'Questions', short: 'question' },
  praise: { label: 'Bien vu', group: 'Bien vu', short: 'bien vu' },
  info: { label: 'Contexte', group: 'Contexte', short: 'contexte' },
};
const VERDICTS = {
  request_changes: 'Request changes',
  comment: 'Commentaires sans blocage',
  approve: 'Approve',
};

const prLabel = (pr) => { const n = String(pr || '').match(/(?:pull\/|^#?)(\d+)/); return n ? `PR #${n[1]}` : 'PR'; };
const blockKind = (b) => (KINDS[b.kind] ? b.kind : 'info');

function verdictOf(report) {
  if (VERDICTS[report.verdict]) return report.verdict;
  const kinds = report.blocks.map(blockKind);
  if (kinds.includes('blocking')) return 'request_changes';
  return kinds.some((k) => ['fix', 'suggestion', 'question'].includes(k)) ? 'comment' : 'approve';
}

function kindCounts(report) {
  return Object.keys(KINDS).filter((k) => k !== 'info').map((k) => [k, report.blocks.filter((b) => blockKind(b) === k).length]).filter(([, n]) => n);
}

function reviewChips(wt) {
  const r = wt.review;
  if (!r) return [];
  const chips = [`<span class="chip review">Review · ${esc(prLabel(r.pr))}</span>`];
  if (!r.report) return [...chips, '<span class="chip">rapport en attente</span>'];
  return [...chips, ...kindCounts(r.report).map(([k, n]) => `<span class="chip k-${k}">${n} ${KINDS[k].short}${n > 1 && !['à corriger', 'bien vu'].includes(KINDS[k].short) ? 's' : ''}</span>`)];
}

let reportSignature = null;
const drafts = [];

function minimap(rep, verdict, groups) {
  const blocks = groups.flatMap(([, list]) => list);
  const strip = blocks.map((b, i) => `<button class="mm ${blockKind(b)}" data-jump="r-b-${i}" title="${esc(b.title)}"></button>`).join('');
  let i = 0;
  const sections = groups.map(([k, list]) => `
    <button class="mm-link mm mm-group ${k}" data-jump="r-g-${k}"><span class="mm-dot"></span>${KINDS[k].group}<span class="n">${list.length}</span></button>
    ${list.map((b) => {
      const file = b.file ? `${b.file.split('/').pop()}${b.line ? `:${b.line}` : ''}` : '';
      return `<button class="mm-link mm mm-item ${k}" data-jump="r-b-${i++}" title="${esc(b.file || b.title)}"><span class="t">${esc(String(b.title).replace(/`/g, ''))}</span>${file ? `<span class="f">${esc(file)}</span>` : ''}</button>`;
    }).join('')}`).join('');
  return `<h3>Vue d'ensemble</h3>
    <div class="mm-strip">${strip}</div>
    <button class="mm-link mm-verdict ${verdict}" data-jump="r-verdict">${VERDICTS[verdict]}</button>
    ${sections}`;
}

function jumpTo(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  $('report').scrollTo({ top: target.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
}

function trackMinimap() {
  const box = $('report');
  const anchors = [...box.querySelectorAll('[id^="r-"]')];
  if (!anchors.length) return;
  const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 4;
  const current = atEnd ? anchors[anchors.length - 1] : anchors.filter((a) => a.offsetTop - box.scrollTop <= 80).pop() || anchors[0];
  const id = current.id.startsWith('r-g-') ? anchors[anchors.indexOf(current) + 1]?.id || current.id : current.id;
  document.querySelectorAll('#minimap [data-jump]').forEach((el) => el.classList.toggle('on', el.dataset.jump === id));
  const active = document.querySelector(`#minimap .mm-link[data-jump="${id}"]`);
  if (active) {
    const map = $('minimap');
    if (active.offsetTop < map.scrollTop || active.offsetTop + active.offsetHeight > map.scrollTop + map.clientHeight) active.scrollIntoView({ block: 'nearest' });
  }
}

function reportBlock(b, i) {
  const k = blockKind(b);
  const sec = (title, text) => (text ? `<div class="rb-sec"><h5>${title}</h5>${md(String(text))}</div>` : '');
  const loc = b.file ? `<div class="rb-loc">${esc(b.file)}${b.line ? `:${esc(b.line)}` : ''}</div>` : '';
  const draft = b.comment ? `<div class="rb-draft"><div class="row"><h5>Brouillon de commentaire</h5><button class="btn" data-draft="${drafts.push(String(b.comment)) - 1}">Copier</button></div>${md(String(b.comment))}</div>` : '';
  const index = reportBlocks.push(b) - 1;
  const actions = ['blocking', 'fix', 'suggestion'].includes(k) || b.file
    ? `<div class="rb-actions">${['blocking', 'fix', 'suggestion'].includes(k) ? `<button class="btn" data-fixblock="${index}">Faire corriger par Claude</button>` : ''}${b.file ? `<button class="btn" data-showdiff="${index}">Voir dans le diff</button>` : ''}</div>`
    : '';
  return `<article class="rb ${k}" id="r-b-${i}">
    <div class="rb-head"><span class="rb-tag">${KINDS[k].label}</span><span class="rb-title">${esc(b.title)}</span>${loc}</div>
    <div class="rb-body">${sec('Constat', b.finding)}${sec('Impact', b.impact)}${sec('Correctif proposé', b.fix)}${draft}${actions}</div>
  </article>`;
}

function renderReport(wt) {
  const r = wt.review;
  const signature = r ? `${wt.path}|${JSON.stringify(r)}` : null;
  if (signature === reportSignature) return;
  reportSignature = signature;
  drafts.length = 0;
  reportBlocks = [];
  const box = $('report');
  $('report-grid').classList.toggle('no-map', !r?.report);
  if (!r?.report) $('minimap').innerHTML = '';
  if (!r) { box.innerHTML = ''; return; }
  const prLink = /^https?:\/\//.test(r.pr || '') ? r.pr : null;
  if (!r.report) {
    box.innerHTML = `<div class="report-head"><div class="pr">Review ${prLink ? `<a href="${esc(prLink)}" target="_blank" rel="noopener">${esc(prLabel(r.pr))} ↗</a>` : esc(prLabel(r.pr))}</div></div>
      <div class="placeholder">La review est en cours. Le rapport s'affiche ici dès que la session l'a écrit${r.startedAt ? ` (lancée il y a ${ago(r.startedAt)})` : ''}.</div>`;
    return;
  }
  const rep = r.report;
  const url = rep.pr?.url || prLink;
  const verdict = verdictOf(rep);
  const title = `${prLabel(url || r.pr)}${rep.pr?.title ? ` · ${rep.pr.title}` : ''}`;
  const sub = [rep.pr?.author && `par ${rep.pr.author}`, rep.generatedAt && `rapport du ${new Date(rep.generatedAt).toLocaleString()}`, `${rep.blocks.length} point${rep.blocks.length > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
  const groups = Object.keys(KINDS).map((k) => [k, rep.blocks.filter((b) => blockKind(b) === k)]).filter(([, list]) => list.length);
  const scrollTop = box.scrollTop;
  let index = 0;
  $('minimap').innerHTML = minimap(rep, verdict, groups);
  box.innerHTML = `
    <div class="report-head">
      <div class="pr">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(title)} ↗</a>` : esc(title)}</div>
      <div class="sub">${esc(sub)}</div>
    </div>
    <div class="verdict ${verdict}" id="r-verdict"><b>${VERDICTS[verdict]}</b>${rep.summary ? md(String(rep.summary)) : ''}</div>
    <div class="legend">${kindCounts(rep).map(([k, n]) => `<span class="chip k-${k}">${n} · ${KINDS[k].group}</span>`).join('')}</div>
    ${groups.map(([k, list]) => `<section class="rgroup ${k}" id="r-g-${k}"><h3>${KINDS[k].group}</h3>${list.map((b) => reportBlock(b, index++)).join('')}</section>`).join('')}`;
  box.scrollTop = scrollTop;
  trackMinimap();
}

$('report').addEventListener('scroll', trackMinimap, { passive: true });
$('minimap').addEventListener('click', (e) => {
  const link = e.target.closest('[data-jump]');
  if (link) jumpTo(link.dataset.jump);
});
