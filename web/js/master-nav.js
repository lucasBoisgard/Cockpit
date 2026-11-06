// Master-first navigation: the master is one click away from any chat, agents stay folded behind it
// and the composer says when it writes to an agent. Decisions live in master-first.js.

function masterButton(orch) {
  if (!orch) return '';
  const here = chatSession === orch.masterSessionId;
  return `<button class="btn master-btn ${here ? 'on' : ''}" data-open-master="${esc(orch.masterSessionId)}" title="Conversation du maître">◆ Maître</button>`;
}

function agentsToggle(picker) {
  if (!picker.canFold) return '';
  const needs = picker.needs ? ` <span class="lane-badge" title="Agents qui attendent ta réponse">❓ ${picker.needs}</span>` : '';
  return `<button class="btn" data-chat-agents>${chatAgentsOpen ? '▾' : '▸'} ${picker.agents.length} agent${picker.agents.length > 1 ? 's' : ''}${needs}</button>`;
}

function renderComposerTarget(s) {
  const box = $('composer-target');
  const target = s ? composerTarget(s.sessionId, state.orchestrations) : null;
  $('composer').classList.toggle('to-agent', !!target);
  box.hidden = !target;
  if (!target) return;
  box.innerHTML = `<span>Tu écris à <b>${esc(target.agentId)}</b>, pas au maître.</span><button class="btn" data-send-master>Envoyer au maître à la place</button>`;
}

function openMasterSession(masterSessionId) {
  tab = 'chat'; renderTabs();
  chatLane = 'conversation';
  openAgentSession(masterSessionId);
}

let groupingCache = { key: null, grouping: null };
let boardOpenVersion = 0;

function boardGrouping() {
  const key = [state, state.worktrees, state.orchestrations, finishedUi.show, boardOpenVersion];
  if (groupingCache.key?.every((v, i) => v === key[i])) return groupingCache.grouping;
  groupingCache = { key, grouping: groupWorktrees(shownWorktrees(), state.orchestrations, boardAgentsOpen) };
  return groupingCache.grouping;
}

function boardWorktrees(list) {
  const grouping = boardGrouping();
  const extra = selected && grouping.masterPathOf(selected) ? list.find((w) => w.path === selected) : null;
  return grouping.top.flatMap((wt) => {
    const shown = grouping.visibleChildren(wt.path);
    return [wt, ...(extra && grouping.masterPathOf(selected) === wt.path && !shown.includes(extra) ? [...shown, extra] : shown)];
  });
}

function agentsStrip(wt, kind) {
  const summary = boardGrouping().summary(wt.path);
  if (!summary.count) return '';
  const open = boardAgentsOpen.has(wt.path);
  const needs = summary.needs ? ` <span class="lane-badge">❓ ${summary.needs}</span>` : '';
  return `<button type="button" class="agents-fold agents-fold-${kind}" data-agents-fold="${esc(wt.path)}" aria-expanded="${open}">${open ? '▾' : '▸'} ${summary.count} agent${summary.count > 1 ? 's' : ''}${needs}</button>`;
}

document.addEventListener('click', (e) => {
  const fold = e.target.closest('[data-agents-fold]');
  if (fold) {
    e.stopImmediatePropagation();
    const path = fold.dataset.agentsFold;
    if (boardAgentsOpen.has(path)) boardAgentsOpen.delete(path); else boardAgentsOpen.add(path);
    boardOpenVersion++;
    renderGrid();
    return;
  }
  const master = e.target.closest('[data-open-master]');
  if (master) { openMasterSession(master.dataset.openMaster); return; }
  if (e.target.closest('[data-chat-agents]')) { chatAgentsOpen = !chatAgentsOpen; chatBarSignature = null; renderChatBar(currentWt()); return; }
  if (e.target.closest('[data-send-master]')) {
    const orch = orchestrationOfSession(chatSession, state.orchestrations);
    if (!orch) return;
    const draft = $('composer-input').value;
    openMasterSession(orch.masterSessionId);
    if (chatSession !== orch.masterSessionId) { $('composer-input').value = draft; return; }
    $('composer-input').value = draft;
    autosizeComposer();
    if (draft.trim()) sendMessage(); else $('composer-input').focus();
  }
}, true);
