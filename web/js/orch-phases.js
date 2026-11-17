function orchActivePhases(orch) {
  const last = orch.phases.length - 1;
  if (last < 0) return [];
  const raw = Array.isArray(orch.activePhases) && orch.activePhases.length ? orch.activePhases : [orch.phase];
  const clamp = (i) => Math.max(0, Math.min(Number.isInteger(i) ? i : 0, last));
  return [...new Set(raw.map(clamp))].sort((a, b) => a - b);
}

const orchActivePhasesJoined = (active) => active.map((i) => i + 1).join(' · ');

function orchActivePhasesLabel(orch) {
  if (!orch.phases.length) return 'Pas encore de plan';
  const active = orchActivePhases(orch);
  if (active.length > 1) return `Phases ${orchActivePhasesJoined(active)} en parallèle`;
  return `Phase ${active[0] + 1}/${orch.phases.length} · ${orch.phases[active[0]] || ''}`;
}

function orchActivePhasesDetail(orch) {
  if (!orch.phases.length) return 'pas de plan';
  const active = orchActivePhases(orch);
  if (active.length > 1) return `${orchActivePhasesJoined(active)} en parallèle (sur ${orch.phases.length})`;
  return `${active[0] + 1}/${orch.phases.length} · ${orch.phases[active[0]] || ''}`;
}

function orchActivePhasesShort(orch) {
  if (!orch.phases.length) return 'sans plan';
  const active = orchActivePhases(orch);
  return active.length > 1 ? `phases ${orchActivePhasesJoined(active)}` : orch.phases[active[0]] || 'sans plan';
}

if (typeof module !== 'undefined') module.exports = { orchActivePhases, orchActivePhasesLabel, orchActivePhasesDetail, orchActivePhasesShort };
