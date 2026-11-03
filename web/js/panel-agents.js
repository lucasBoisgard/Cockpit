function gearPath(teeth, outer, inner) {
  const steps = teeth * 4;
  const points = Array.from({ length: steps }, (_, i) => {
    const angle = ((i + 0.5) / steps) * Math.PI * 2;
    const r = i % 4 < 2 ? outer : inner;
    return `${(Math.cos(angle) * r).toFixed(2)},${(Math.sin(angle) * r).toFixed(2)}`;
  });
  return `M${points.join('L')}Z`;
}

const GEAR_PATH = gearPath(9, 10, 7.4);

function gearSvg(size, extra = '') {
  return `<svg class="agents-gear ${extra}" viewBox="-11 -11 22 22" width="${size}" height="${size}" aria-hidden="true"><path d="${GEAR_PATH}"/><circle r="3.2"/></svg>`;
}

const AGENT_STATE = { running: 'En cours', waiting: 'Attend ta réponse', idle: 'En pause', done: 'Terminé' };

const SKILL_ICON = '<svg class="agents-skill-icon" viewBox="-8 -8 16 16" width="14" height="14" aria-hidden="true"><path d="M0-7.5L1.9-1.9L7.5 0L1.9 1.9L0 7.5L-1.9 1.9L-7.5 0L-1.9-1.9Z"/></svg>';

function skillNodeHtml(skill) {
  return `<li class="agents-skill-li"><div class="agents-skill ${esc(skill.state)}" title="Skill ${esc(skill.label)}">${SKILL_ICON}<span class="agents-skill-name">${esc(skill.label)}</span><span class="agents-skill-kind">skill</span></div></li>`;
}

function agentNodeHtml(node) {
  const root = node.kind === 'main';
  const state = node.acting ? 'En action' : AGENT_STATE[node.state] || node.state;
  const chips = [
    node.kind === 'workflow' ? '<span class="agents-chip">workflow</span>' : '',
    node.type && node.type !== 'workflow-subagent' ? `<span class="agents-chip">${esc(node.type)}</span>` : '',
    node.phase ? `<span class="agents-chip">${esc(node.phase)}</span>` : '',
    node.background ? '<span class="agents-chip">arrière-plan</span>' : '',
  ].join('');
  const gears = root ? `<span class="agents-gears">${gearSvg(34)}${gearSvg(20, 'agents-gear-small')}</span>` : gearSvg(24);
  const items = [...(node.skills || []).map(skillNodeHtml), ...(node.children || []).map(agentNodeHtml)];
  const children = items.length ? `<ul>${items.join('')}</ul>` : '';
  return `<li><div class="agents-node ${root ? 'agents-root-node' : ''} ${esc(node.state)} ${node.acting ? 'agents-acting' : ''}">
      ${gears}
      <div class="agents-body">
        <div class="agents-title"><b title="${esc(node.label)}">${esc(root ? 'Agent principal' : node.label)}</b>${chips}<span class="agents-state">${esc(state)}</span></div>
        ${root && node.label ? `<div class="agents-task" title="${esc(node.label)}">${esc(node.label)}</div>` : ''}
        ${node.action ? `<div class="agents-action"><span class="agents-tool">${esc(node.action.tool)}</span> ${esc(node.action.detail || '')}</div>` : ''}
      </div>
    </div>${children}</li>`;
}

async function loadAgents() {
  if (tab !== 'agents') return;
  const sessionId = chatSession;
  if (!sessionId) { setHtml($('agents-tree'), '<div class="placeholder">Aucune session dans ce worktree.</div>'); return; }
  const res = await api(`/api/agents?session=${encodeURIComponent(sessionId)}`).catch(() => null);
  if (chatSession !== sessionId || tab !== 'agents') return;
  if (!res?.ok) { setHtml($('agents-tree'), '<div class="placeholder">Transcript introuvable pour cette session.</div>'); return; }
  const data = await res.json().catch(() => null);
  if (!data) return;
  const { tree, running } = data;
  const summary = running ? `${running} sous-agent${running > 1 ? 's' : ''} en cours` : 'Aucun sous-agent en cours';
  setHtml($('agents-tree'), `<div class="agents-summary">${summary} · les roues tournent pendant une action, les skills du tour en cours brillent, les agents terminés restent 5 min</div><ul class="agents-tree">${agentNodeHtml(tree)}</ul>`);
  $('agents-tree').querySelectorAll('.agents-gear, .agents-skill').forEach((el) => el.getAnimations().forEach((a) => { a.startTime = 0; }));
}

setInterval(() => { if ($('panel').classList.contains('open') && tab === 'agents') loadAgents(); }, 2000);
