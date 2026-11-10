function describeSchedule(a) {
  if (a.schedule.type === 'interval') return `toutes les ${a.schedule.minutes} min`;
  const names = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  return `à ${a.schedule.time}, ${a.schedule.days.length === 7 ? 'tous les jours' : a.schedule.days.map((d) => names[d]).join(' ')}`;
}

async function openAutomations() {
  openPage($('auto-dialog'));
  const res = await api('/api/automations').catch(() => null);
  const list = res?.ok ? await res.json() : [];
  const when = (t) => new Date(t).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const runState = (a) => {
    if (!a.enabled) return ['paused', 'En pause'];
    if (!a.lastRun) return ['never', 'Jamais lancée'];
    return a.lastOk === false ? ['failed', 'Dernier lancement en échec'] : ['ran', 'Lancée'];
  };
  const sessionLine = (a) => {
    const wt = a.lastWorktree && state.worktrees.find((w) => w.name === a.lastWorktree);
    if (!a.lastWorktree) return '';
    if (!wt) return ` · session : worktree ${esc(a.lastWorktree)} fermé`;
    return ` · session : <b>${esc(STATUS[sessionStatus(wt)].label)}</b> dans ${esc(wt.name)}`;
  };
  const notice = state.tick ? '' : '<div class="notice">Ce serveur tourne sans boucle de fond (lancé sans COCKPIT_TICK=1, comme une instance de test) : les automatisations ne se lancent pas toutes seules ici. « Lancer maintenant » fonctionne.</div>';
  $('auto-list').innerHTML = notice + (list.length ? list.map((a) => `<div class="row">
      <div class="top-line"><span class="grow">${esc(a.name)}</span><span class="auto-state ${runState(a)[0]}">${runState(a)[1]}</span></div>
      <div class="meta-line">${a.provider === 'codex' ? 'GPT' : 'Claude'} · ${esc(describeSchedule(a))} · worktree ${esc(a.worktree)}${a.newWorktree ? '-<date>' : ''}</div>
      <div class="meta-line">${a.nextRun ? `Prochain lancement : <b>${a.nextRun - Date.now() < 60000 ? (state.tick ? 'maintenant' : 'maintenant, mais la boucle de fond est désactivée ici') : esc(when(a.nextRun))}</b>` : 'Pas de prochain lancement'}${a.lastRun ? ` · dernier : ${esc(when(a.lastRun))} (${esc(a.lastResult || '')})` : ''}${sessionLine(a)}</div>
      <div class="meta-line">${esc(a.prompt.slice(0, 200))}</div>
      <div class="actions-line"><button class="btn" data-arun="${esc(a.id)}">Lancer maintenant</button><button class="btn" data-aedit="${esc(a.id)}">Modifier</button><button class="btn" data-atoggle="${esc(a.id)}">${a.enabled ? 'Mettre en pause' : 'Activer'}</button><button class="btn" data-adel="${esc(a.id)}">Supprimer</button></div>
    </div>`).join('') : '<p class="text">Aucune automatisation.</p>');
  $('auto-list').dataset.items = JSON.stringify(list);
}

function fillAutomationForm(a) {
  editingAutomation = a?.id || null;
  $('auto-form-title').textContent = a ? `Modifier « ${a.name} »` : 'Nouvelle automatisation';
  $('auto-name').value = a?.name || '';
  $('auto-provider').value = a?.provider || 'claude';
  $('auto-worktree').value = a?.worktree || '';
  $('auto-new').checked = !!a?.newWorktree;
  $('auto-prompt').value = a?.prompt || '';
  $('auto-type').value = a?.schedule.type || 'daily';
  $('auto-time').value = a?.schedule.time || '09:00';
  $('auto-minutes').value = a?.schedule.minutes || 60;
  const days = a?.schedule.days || [1, 2, 3, 4, 5];
  document.querySelectorAll('#auto-days input').forEach((c) => { c.checked = days.includes(Number(c.value)); });
  syncAutoType();
}

function syncAutoType() {
  const daily = $('auto-type').value === 'daily';
  $('auto-time-label').hidden = !daily;
  $('auto-days').hidden = !daily;
  $('auto-minutes-label').hidden = daily;
}

$('auto-type').addEventListener('change', syncAutoType);
$('auto-reset').addEventListener('click', () => fillAutomationForm(null));
$('auto-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const item = {
    id: editingAutomation,
    name: $('auto-name').value,
    provider: $('auto-provider').value,
    worktree: $('auto-worktree').value.trim(),
    newWorktree: $('auto-new').checked,
    prompt: $('auto-prompt').value,
    tzOffsetMin: new Date().getTimezoneOffset(),
    schedule: $('auto-type').value === 'daily'
      ? { type: 'daily', time: $('auto-time').value, days: [...document.querySelectorAll('#auto-days input:checked')].map((c) => Number(c.value)) }
      : { type: 'interval', minutes: Number($('auto-minutes').value) },
  };
  const result = await post('/api/automations/save', { item });
  if (!result.ok) { toast(result.data.error || 'Enregistrement impossible.', 'error'); return; }
  toast('Automatisation enregistrée.');
  fillAutomationForm(null);
  openAutomations();
});
$('auto-list').addEventListener('click', async (e) => {
  const list = parseJson($('auto-list').dataset.items, []);
  const find = (id) => list.find((a) => a.id === id);
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.arun) {
    b.disabled = true;
    const result = await post('/api/automations/run', { id: b.dataset.arun });
    toast(result.ok ? `Lancée dans ${result.data.worktree}.` : result.data.error || 'Lancement impossible.', result.ok ? '' : 'error');
    openAutomations();
    refresh();
  } else if (b.dataset.aedit) {
    fillAutomationForm(find(b.dataset.aedit));
    $('auto-name').focus();
  } else if (b.dataset.atoggle) {
    const a = find(b.dataset.atoggle);
    await post('/api/automations/save', { item: { ...a, enabled: !a.enabled } });
    openAutomations();
  } else if (b.dataset.adel) {
    if (!confirm(`Supprimer l'automatisation « ${find(b.dataset.adel)?.name} » ?`)) return;
    await post('/api/automations/delete', { id: b.dataset.adel });
    openAutomations();
  }
});
