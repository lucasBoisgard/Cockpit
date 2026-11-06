// Orchestration tab of a master session: its team as a tree (master → phases → agents → sub-agents) on a
// full canvas, a floating inspector for the picked node, a floating box to write to the master, and the
// master's controls (pause, settings, end). Data comes from the snapshot's `orchestrations`.
const ORCH_WORD = { starting: 'Démarre', working: 'Travaille', needs: 'Te demande', done: 'A fini', stopped: 'Arrêté', idle: 'Prévue' };
const ORCH_MODE = { acceptEdits: 'modifs auto-acceptées', auto: 'auto', default: 'permissions par défaut', plan: 'plan' };
const ORCH_MODE_SHORT = { acceptEdits: 'edits', auto: 'auto', default: 'manuel', plan: 'plan' };
const orchModeLabel = (mode, pending) => `${ORCH_MODE[mode] || mode || 'inconnu'}${pending ? ' · à la fin de son tour' : ''}`;
const ORCH_AUTONOMY = { blocking: 'Seulement si bloquant', milestones: 'Aux étapes clés', decisions: 'À chaque décision' };
const ORCH_COL = 270;
const ORCH_SIZE = { master: [220, 74], phase: [170, 52], agent: [240, 68] };
const ORCH_VGAP = 14;
const orchUi = { byPhase: localGet('orchByPhase') !== '0', zoom: 1, collapsed: new Set(), pick: {}, inspector: {}, compose: false, settings: false, signature: '' };

const currentOrch = () => (currentWt() ? orchestrationOf(currentWt()) : null);

function orchPhaseStatus(agents) {
  if (!agents.length) return 'idle';
  if (agents.some((a) => a.status === 'needs')) return 'needs';
  if (agents.some((a) => a.status === 'working' || a.status === 'starting')) return 'working';
  return agents.every((a) => a.status === 'stopped') ? 'stopped' : 'done';
}

function orchTree(orch) {
  const hidden = finishedUi.show ? new Set() : hiddenAgentIds(orch.agents);
  const childrenOf = (parentId) => orch.agents.filter((a) => a.parentId === parentId && !hidden.has(a.id));
  const agentNode = (a) => ({ id: a.id, kind: 'agent', status: a.status, agent: a, children: childrenOf(a.id).map(agentNode) });
  const allTop = orch.agents.filter((a) => !a.parentId || !orch.agents.some((p) => p.id === a.parentId));
  const top = allTop.filter((a) => !hidden.has(a.id));
  const hiddenByRoot = hiddenCountByRoot(orch.agents, hidden);
  const masterStatus = orch.state === 'paused' ? 'stopped' : orch.state === 'needs' ? 'needs' : orch.state === 'working' ? 'working' : 'done';
  const children = orchUi.byPhase && orch.phases.length
    ? orch.phases.map((name, i) => {
      const agents = top.filter((a) => a.phase === i);
      const hiddenCount = allTop.filter((a) => a.phase === i).reduce((n, a) => n + (hiddenByRoot.get(a.id) || 0), 0);
      return { id: `p${i}`, kind: 'phase', name, index: i, status: orchPhaseStatus(allTop.filter((a) => a.phase === i)), hiddenCount, children: agents.map(agentNode) };
    })
    : top.map(agentNode);
  return { id: 'm', kind: 'master', status: masterStatus, hiddenCount: orchUi.byPhase && orch.phases.length ? 0 : hidden.size, children };
}

// Tidy horizontal tree: depth goes right, siblings stack downward, a parent sits at the middle of its children.
function orchLayout(root) {
  const placed = [];
  let cursor = 0;
  const walk = (node, depth) => {
    const [w, h] = ORCH_SIZE[node.kind];
    const open = node.children.length && !orchUi.collapsed.has(node.id);
    let y;
    if (open) {
      const kids = node.children.map((c) => walk(c, depth + 1));
      y = (kids[0].y + kids[0].h / 2 + kids[kids.length - 1].y + kids[kids.length - 1].h / 2) / 2 - h / 2;
      node.placedKids = kids;
    } else {
      y = cursor;
      cursor += h + ORCH_VGAP;
      node.placedKids = [];
    }
    const box = { node, x: depth * ORCH_COL, y, w, h };
    placed.push(box);
    return box;
  };
  walk(root, 0);
  const minY = Math.min(...placed.map((b) => b.y));
  for (const b of placed) b.y -= minY;
  return { boxes: placed, width: Math.max(...placed.map((b) => b.x + b.w)), height: Math.max(...placed.map((b) => b.y + b.h)) };
}

const orchGear = (status, big = false) => `<span class="orch-gear ${status === 'working' || status === 'starting' ? 'is-spin' : status === 'done' ? 'is-done' : status === 'needs' ? 'is-needs' : ''} ${big ? 'is-big' : ''}"></span>`;

function orchPhaseSub(node) {
  const finished = node.hiddenCount ? `${node.hiddenCount} terminé${node.hiddenCount > 1 ? 's' : ''}` : '';
  if (!node.children.length) return finished || 'à venir';
  return `${node.children.length} agent${node.children.length > 1 ? 's' : ''} · ${ORCH_WORD[node.status].toLowerCase()}${finished ? ` · +${finished}` : ''}`;
}

function orchNodeHtml(box, orch, pick) {
  const { node } = box;
  const toggle = node.children.length ? `<button class="orch-toggle" data-orch-toggle="${node.id}" title="${orchUi.collapsed.has(node.id) ? 'Déplier' : 'Replier'}">${orchUi.collapsed.has(node.id) ? `+${node.children.length}` : '−'}</button>` : '';
  const style = `left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px`;
  const cls = `orch-node orch-${node.kind} orch-s-${node.status} ${pick === node.id ? 'is-picked' : ''}`;
  if (node.kind === 'master') {
    const n = orch.counts.working + orch.counts.starting;
    return `<div class="${cls}" style="${style}" data-orch-node="m"><div class="orch-line">${orchGear(node.status)}<b>◆ Maître</b>${toggle}</div>
      <div class="orch-sub">${orch.paused ? 'En pause' : `${n} actif${n > 1 ? 's' : ''} / ${orch.settings.maxAgents} max`}${node.hiddenCount ? ` · ${node.hiddenCount} terminé${node.hiddenCount > 1 ? 's' : ''}` : ''}</div>
      <div class="orch-act">${esc(orch.phases.length ? `Phase ${orch.phase + 1}/${orch.phases.length} · ${orch.phases[orch.phase] || ''}` : 'Pas encore de plan')}</div></div>`;
  }
  if (node.kind === 'phase') {
    return `<div class="${cls}" style="${style}" data-orch-node="${node.id}"><div class="orch-line"><b>${node.index + 1}. ${esc(node.name)}</b>${toggle}</div>
      <div class="orch-sub">${orchPhaseSub(node)}</div></div>`;
  }
  const a = node.agent;
  const setting = [a.provider === 'codex' ? 'GPT' : null, a.model || 'défaut', a.effort, a.mode ? `${a.modePending ? '⏳ ' : ''}${ORCH_MODE_SHORT[a.mode] || a.mode}` : null, ...(a.skills || [])].filter(Boolean).join(' · ');
  const act = a.unattached ? 'Hook à valider avec /hooks' : a.status === 'needs' ? a.message || 'Attend ta réponse' : a.status === 'working' ? a.action || 'Travaille' : a.status === 'done' ? oneLineText(a.lastAssistant, 80) || 'A fini' : ORCH_WORD[a.status];
  return `<div class="${cls}" style="${style}" data-orch-node="${a.id}"><div class="orch-line">${orchGear(a.status)}<b>${esc(a.id)} · ${esc(a.name)}</b>${toggle}</div>
    <div class="orch-sub">${esc(setting)}${a.isolated ? ' · ⎇ isolé' : ''}</div><div class="orch-act" title="${esc(act)}">${esc(oneLineText(act, 70))}</div></div>`;
}

function orchLinks(layout) {
  const paths = [];
  for (const box of layout.boxes) {
    for (const kid of box.node.placedKids || []) {
      const x1 = box.x + box.w;
      const y1 = box.y + box.h / 2;
      const x2 = kid.x;
      const y2 = kid.y + kid.h / 2;
      const xm = x1 + (x2 - x1) / 2;
      const st = kid.node.status;
      const cls = st === 'working' || st === 'starting' ? 'is-live' : st === 'needs' ? 'is-needs' : st === 'done' ? 'is-done' : 'is-wait';
      paths.push(`<path class="orch-link ${cls}" d="M${x1} ${y1} H${xm} V${y2} H${x2}"/>`);
    }
  }
  return paths.join('');
}

function orchInspector(orch, pick) {
  const master = orch.masterSessionId;
  if (pick === 'm') {
    const events = orch.events.slice(-14).reverse().map((e) => `<li><span class="orch-time">${new Date(e.at).toTimeString().slice(0, 5)}</span>${esc(e.text)}</li>`).join('');
    return `<h4>Maître</h4><p class="orch-goal">${esc(oneLineText(orch.goal, 400))}</p>
      <dl class="orch-kv"><dt>Phase</dt><dd>${orch.phases.length ? `${orch.phase + 1}/${orch.phases.length} · ${esc(orch.phases[orch.phase] || '')}` : 'pas de plan'}</dd>
      <dt>Agents</dt><dd>${orch.counts.working + orch.counts.starting} actifs · ${orch.counts.total} lancés · ${orch.settings.maxAgents} max</dd>
      <dt>Me solliciter</dt><dd>${ORCH_AUTONOMY[orch.settings.autonomy] || orch.settings.autonomy}</dd>
      <dt>Profondeur</dt><dd>${orch.settings.maxDepth} niveau${orch.settings.maxDepth > 1 ? 'x' : ''}</dd>
      <dt>Permissions</dt><dd>${esc(orchModeLabel(orch.settings.agentMode, orch.masterModePending))}</dd></dl>
      <div class="orch-row"><button class="btn" data-orch-session="${esc(master)}">Conversation du maître</button></div>
      <h4>Journal</h4><ul class="orch-events">${events || '<li>Rien pour l’instant.</li>'}</ul>`;
  }
  if (pick.startsWith('p')) {
    const index = Number(pick.slice(1));
    const agents = orch.agents.filter((a) => a.phase === index);
    return `<h4>Phase ${index + 1} · ${esc(orch.phases[index] || '')}</h4><div class="orch-list">${agents.map((a) => `<button class="orch-item" data-orch-pick="${a.id}">${orchGear(a.status)}<span>${esc(a.id)} · ${esc(a.name)}</span><span class="orch-state orch-c-${a.status}">${ORCH_WORD[a.status]}</span></button>`).join('') || '<p class="orch-muted">Le maître n’a pas encore lancé d’agent pour cette phase.</p>'}</div>`;
  }
  const a = orch.agents.find((x) => x.id === pick);
  if (!a) return '';
  const files = a.files?.length ? `<h4>Fichiers modifiés</h4><ul class="orch-files">${a.files.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '';
  const keys = PROVIDER_KEYS[a.provider] || PROVIDER_KEYS.claude;
  const op = (k) => esc(JSON.stringify(k));
  const answer = a.status === 'needs' ? `<div class="orch-ask"><b>${esc(a.id)} te demande</b><p>${esc(a.message || 'Une réponse dans son terminal.')}</p><div class="orch-row"><button class="btn orch-main" data-orch-op="${op(keys.allow)}" data-orch-target="${esc(a.sessionId)}">Autoriser</button><button class="btn" data-orch-op="${op(keys.deny)}" data-orch-target="${esc(a.sessionId)}">Refuser</button><button class="btn" data-orch-session="${esc(a.sessionId)}">Voir</button></div></div>`
    : a.unattached ? `<div class="orch-ask"><b>Hook à valider</b><p>Codex n’exécute le hook du cockpit qu’une fois validé : ouvre le terminal de cet agent, tape /hooks et fais-lui confiance. Le cockpit suivra alors son état.</p></div>` : '';
  const live = ['working', 'starting', 'needs', 'done'].includes(a.status);
  return `<h4>Agent · ${esc(a.id)}</h4><div class="orch-line">${orchGear(a.status, true)}<b class="orch-title">${esc(a.name)}</b></div>
    <div class="orch-chips">${a.provider === 'codex' ? '<span class="chip shead-gpt">GPT · Codex</span>' : ''}<span class="chip">${esc([a.model || 'modèle par défaut', a.effort].filter(Boolean).join(' · '))}</span>${(a.skills || []).map((s) => `<span class="chip">✦ ${esc(s)}</span>`).join('')}<span class="orch-state orch-c-${a.status}">${ORCH_WORD[a.status]}</span>${a.isolated ? `<span class="chip">⎇ ${esc(a.branch || 'isolé')}</span>` : ''}</div>
    ${answer}
    ${a.action && a.status === 'working' ? `<p class="orch-muted">${esc(a.action)}</p>` : ''}
    <div class="orch-row"><button class="btn" data-orch-session="${esc(a.sessionId)}">Conversation</button><button class="btn" data-orch-read="${esc(a.sessionId)}">Dernier rapport</button>
      ${live ? `<button class="btn" data-orch-stop="${esc(a.id)}">Arrêter</button>` : `<button class="btn" data-orch-resume="${esc(a.id)}">Relancer</button>`}</div>
    <form class="orch-send" data-orch-send="${esc(a.id)}"><input name="text" placeholder="Écrire à ${esc(a.id)}…" autocomplete="off"><button class="btn">Envoyer</button></form>
    <h4>Brief du maître</h4><p class="orch-brief">${esc(a.brief || '')}</p>
    <dl class="orch-kv"><dt>Type de tâche</dt><dd>${esc(a.kind || 'non précisé')}</dd>${a.rating ? `<dt>Note du maître</dt><dd>${a.rating.score}/5${a.rating.note ? ` · ${esc(a.rating.note)}` : ''}</dd>` : ''}<dt>Phase</dt><dd>${esc(orch.phases[a.phase] || String(a.phase + 1))}</dd><dt>Lancé par</dt><dd>${a.parentId ? esc(a.parentId) : 'le maître'}</dd><dt>Permissions</dt><dd>${esc(orchModeLabel(a.mode, a.modePending))}</dd></dl>${files}`;
}

function orchSettings(orch) {
  return `<form class="orch-settings" data-orch-settings>
    <label>Me solliciter<select name="autonomy">${Object.entries(ORCH_AUTONOMY).map(([k, l]) => `<option value="${k}" ${orch.settings.autonomy === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label>Agents actifs au maximum<input type="number" name="maxAgents" min="1" max="20" value="${orch.settings.maxAgents}"></label>
    <label>Profondeur maximale des agents<input type="number" name="maxDepth" min="1" max="4" value="${orch.settings.maxDepth}"><small>Niveaux de sous-orchestrateurs sous le maître (plafond 4). Plus c’est profond, plus le coût en tokens grimpe.</small></label>
    <label>Permissions de tous les agents, maître compris<select name="agentMode">${[['acceptEdits', 'Accepter les modifs'], ['auto', 'Auto'], ['default', 'Par défaut'], ['plan', 'Plan']].map(([k, l]) => `<option value="${k}" ${orch.settings.agentMode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <div class="orch-row"><button class="btn primary">Appliquer</button><button type="button" class="btn orch-danger" data-orch-end>Terminer l’orchestration</button></div></form>`;
}

function orchFinishedButton(orch) {
  const n = hiddenAgentIds(orch.agents).size;
  return n || (finishedUi.show && orch.counts.stopped) ? `<button class="orch-btn" data-finished-toggle aria-pressed="${finishedUi.show}">${finishedLabel(n)}</button>` : '';
}

function renderOrchestration(force = false) {
  const view = $('orch-view');
  const orch = currentOrch();
  if (!orch || tab !== 'orch') return;
  const master = orch.masterSessionId;
  const pick = orchUi.pick[master] || null;
  const inspector = orchUi.inspector[master] && pick;
  const signature = JSON.stringify([orch, orchUi.byPhase, finishedUi.show, orchUi.zoom, [...orchUi.collapsed], pick, inspector, orchUi.compose, orchUi.settings]);
  if (!force && signature === orchUi.signature) return;
  orchUi.signature = signature;
  const layout = orchLayout(orchTree(orch));
  const scroller = view.querySelector('.orch-scroll');
  const scroll = scroller ? [scroller.scrollLeft, scroller.scrollTop] : null;
  const draft = view.querySelector('#orch-compose-input')?.value || '';
  const sendDrafts = [...view.querySelectorAll('[data-orch-send] input')].map((i) => [i.closest('form').dataset.orchSend, i.value]);
  const z = orchUi.zoom;
  view.innerHTML = `<div class="orch-canvas ${orch.paused ? 'is-paused' : ''}">
    <div class="orch-scroll ${inspector ? 'with-inspector' : ''}"><div class="orch-stage" style="width:${layout.width * z}px;height:${layout.height * z}px">
      <div class="orch-scale" style="transform:scale(${z});width:${layout.width}px;height:${layout.height}px">
        <svg class="orch-svg" width="${layout.width}" height="${layout.height}">${orchLinks(layout)}</svg>
        ${layout.boxes.map((b) => orchNodeHtml(b, orch, pick)).join('')}
      </div></div></div>
    <div class="orch-tools">
      <div class="orch-seg" role="group" aria-label="Regroupement"><button data-orch-group="1" aria-pressed="${orchUi.byPhase}">Par phase</button><button data-orch-group="0" aria-pressed="${!orchUi.byPhase}">Par agent</button></div>
      ${orchUi.collapsed.size ? '<button class="orch-btn" data-orch-expand>Tout déplier</button>' : ''}
      ${orchFinishedButton(orch)}
      <span class="orch-grow"></span>
      <button class="orch-btn ${orch.paused ? 'is-on' : ''}" data-orch-pause="${orch.paused ? '0' : '1'}">${orch.paused ? 'Reprendre' : 'Pause'}</button>
      <span class="orch-pop"><button class="orch-btn" data-orch-settings-open aria-expanded="${orchUi.settings}">Réglages</button>${orchUi.settings ? orchSettings(orch) : ''}</span>
      <div class="orch-seg"><button data-orch-zoom="-1" aria-label="Zoom arrière">−</button><button data-orch-zoom="0">${Math.round(z * 100)} %</button><button data-orch-zoom="1" aria-label="Zoom avant">+</button></div>
    </div>
    ${inspector ? `<div class="orch-inspector" role="complementary" aria-label="Détail"><button class="orch-x" data-orch-close aria-label="Fermer le détail">×</button>${orchInspector(orch, pick)}</div>` : ''}
    ${orchUi.compose ? `<form class="orch-compose ${inspector ? 'with-inspector' : ''}" data-orch-compose><textarea id="orch-compose-input" rows="2" placeholder="Écris au maître… (Entrée pour envoyer)"></textarea><button class="btn primary">Envoyer</button><button type="button" class="btn" data-orch-compose-close>Fermer</button></form>`
      : '<button class="orch-write" data-orch-compose-open>✎ Écrire au maître <kbd>e</kbd></button>'}
    ${inspector || orchUi.compose ? '' : '<div class="orch-legend"><span><i class="orch-lg is-live"></i>travaille</span><span><i class="orch-lg is-needs"></i>te demande</span><span><i class="orch-lg is-done"></i>fini</span><span><i class="orch-lg is-wait"></i>en attente</span></div>'}
  </div>`;
  const next = view.querySelector('.orch-scroll');
  if (scroll && next) [next.scrollLeft, next.scrollTop] = scroll;
  const compose = view.querySelector('#orch-compose-input');
  if (compose) { compose.value = draft; if (orchUi.focusCompose) { compose.focus(); orchUi.focusCompose = false; } }
  for (const [id, value] of sendDrafts) { const input = view.querySelector(`[data-orch-send="${CSS.escape(id)}"] input`); if (input) input.value = value; }
}

function openAgentSession(sessionId) {
  const wt = state.worktrees.find((w) => w.sessions.some((s) => s.sessionId === sessionId));
  if (!wt) { toast('Sa session n’est pas encore suivie par le cockpit : réessaie dans quelques secondes.'); return; }
  if (wt.path !== selected) select(wt.path);
  tab = 'chat'; renderTabs(); chatSession = sessionId; chatBarSignature = null; renderPanel(); loadChat(true);
}

async function orchPost(route, body, done) {
  const result = await post(route, body);
  toast(result.ok ? (typeof done === 'function' ? done(result.data) : done) : result.data.error || 'Action impossible.', result.ok ? '' : 'error');
  setTimeout(refresh, 600);
  return result.ok;
}

$('orch-view').addEventListener('click', (e) => {
  const orch = currentOrch();
  if (!orch) return;
  const master = orch.masterSessionId;
  const t = e.target;
  const toggle = t.closest('[data-orch-toggle]');
  if (toggle) { orchUi.collapsed.has(toggle.dataset.orchToggle) ? orchUi.collapsed.delete(toggle.dataset.orchToggle) : orchUi.collapsed.add(toggle.dataset.orchToggle); renderOrchestration(); return; }
  const node = t.closest('[data-orch-node], [data-orch-pick]');
  if (node) { orchUi.pick[master] = node.dataset.orchNode || node.dataset.orchPick; orchUi.inspector[master] = true; renderOrchestration(); return; }
  if (t.closest('[data-orch-close]')) { orchUi.inspector[master] = false; renderOrchestration(); return; }
  const group = t.closest('[data-orch-group]');
  if (group) { orchUi.byPhase = group.dataset.orchGroup === '1'; localSet('orchByPhase', orchUi.byPhase ? '1' : '0'); orchUi.collapsed.clear(); renderOrchestration(); return; }
  if (t.closest('[data-orch-expand]')) { orchUi.collapsed.clear(); renderOrchestration(); return; }
  const zoom = t.closest('[data-orch-zoom]');
  if (zoom) { const d = Number(zoom.dataset.orchZoom); orchUi.zoom = d === 0 ? 1 : Math.max(0.5, Math.min(1.6, orchUi.zoom * (d > 0 ? 1.15 : 1 / 1.15))); renderOrchestration(); return; }
  const pause = t.closest('[data-orch-pause]');
  if (pause) { orchPost('/api/orch/pause', { master, paused: pause.dataset.orchPause === '1' }, pause.dataset.orchPause === '1' ? 'Maître en pause : plus aucun nouvel agent.' : 'Maître relancé.'); return; }
  if (t.closest('[data-orch-settings-open]')) { orchUi.settings = !orchUi.settings; renderOrchestration(); return; }
  if (t.closest('[data-orch-end]')) {
    if (!confirm('Terminer l’orchestration ? Les agents encore actifs sont arrêtés ; leurs conversations restent.')) return;
    orchUi.settings = false;
    orchPost('/api/orch/end', { master, stopAgents: true }, 'Orchestration terminée.');
    return;
  }
  if (t.closest('[data-orch-compose-open]')) { orchUi.compose = true; orchUi.focusCompose = true; renderOrchestration(); return; }
  if (t.closest('[data-orch-compose-close]')) { orchUi.compose = false; renderOrchestration(); return; }
  const session = t.closest('[data-orch-session]');
  if (session) { openAgentSession(session.dataset.orchSession); return; }
  const read = t.closest('[data-orch-read]');
  if (read) { openReaderFor(read.dataset.orchRead, currentWt()?.name); return; }
  const stop = t.closest('[data-orch-stop]');
  if (stop) { if (confirm(`Arrêter ${stop.dataset.orchStop} ? Sa conversation est gardée.`)) orchPost('/api/orch/stop', { caller: master, id: stop.dataset.orchStop, by: 'user' }, `${stop.dataset.orchStop} arrêté.`); return; }
  const resume = t.closest('[data-orch-resume]');
  if (resume) { orchPost('/api/orch/resume', { caller: master, id: resume.dataset.orchResume, by: 'user' }, `${resume.dataset.orchResume} relancé.`); return; }
  const key = t.closest('[data-orch-op]');
  if (key) orchPost('/api/keys', { target: key.dataset.orchTarget, ops: [JSON.parse(key.dataset.orchOp)] }, 'Réponse envoyée.');
});

$('orch-view').addEventListener('submit', async (e) => {
  e.preventDefault();
  const orch = currentOrch();
  if (!orch) return;
  const form = e.target;
  if (form.matches('[data-orch-settings]')) {
    const data = Object.fromEntries(new FormData(form));
    if (await orchPost('/api/orch/settings', { master: orch.masterSessionId, autonomy: data.autonomy, maxAgents: Number(data.maxAgents), agentMode: data.agentMode, maxDepth: data.maxDepth === '' ? undefined : Number(data.maxDepth) }, (r) => (r.modes ? `Permissions : ${r.modes}` : 'Réglages appliqués, le maître est prévenu.'))) { orchUi.settings = false; renderOrchestration(true); }
    return;
  }
  if (form.matches('[data-orch-send]')) {
    const input = form.querySelector('input');
    if (!input.value.trim()) return;
    if (await orchPost('/api/orch/send', { caller: orch.masterSessionId, id: form.dataset.orchSend, text: input.value, by: 'user' }, `Message envoyé à ${form.dataset.orchSend}.`)) input.value = '';
    return;
  }
  if (form.matches('[data-orch-compose]')) {
    const input = form.querySelector('textarea');
    const text = input.value.trim();
    if (!text) return;
    const result = await post('/api/deliver', { target: orch.masterSessionId, text });
    if (!result.ok) { toast(result.data.error || 'Envoi impossible.', 'error'); return; }
    input.value = '';
    orchUi.compose = false;
    toast(result.data.outcome === 'queued' ? 'Message en file : le maître le lira à la fin de son tour.' : 'Message envoyé au maître.');
    renderOrchestration(true);
  }
});

$('orch-view').addEventListener('keydown', (e) => {
  if (e.target.id === 'orch-compose-input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.target.form.requestSubmit(); }
  if (e.key === 'Escape') { const orch = currentOrch(); if (orch) { orchUi.compose = false; orchUi.inspector[orch.masterSessionId] = false; renderOrchestration(); } }
});
