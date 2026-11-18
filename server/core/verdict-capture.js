// Identity, missions, counters and wake lines of the evidence-based verdicts. Pure: the feature layer does the I/O.
const MISSION_ROLES = ['reviewer', 'challenger', 'judge', 'consumer'];
const OUTCOMES = ['as-is', 'fixed', 'partial', 'redone'];
const FINAL_MESSAGE_MAX = 20000;
const RATE_REPLACED = 'Remplacé par orchestrate outcome <id> as-is|fixed|partial|redone : la qualité vient des verdicts des vérificateurs.';

const newObs = (randomBytes) => randomBytes(16).toString('hex');

const pickOf = (agent) => ({ obs: agent.obs, agent: agent.id, category: agent.kind || null, provider: agent.provider || 'claude', model: agent.model || null, effort: agent.effort || '' });

// "reviewer:w1,w2" → { role, targets } ; several specs may be given.
function parseMissions(specs, orch, selfId = null) {
  const missions = [];
  for (const spec of [].concat(specs || []).filter(Boolean)) {
    const [role, list] = String(spec).split(':');
    if (!MISSION_ROLES.includes(role)) return { error: `Rôle de mission inconnu : ${role || spec} (${MISSION_ROLES.join(', ')}).` };
    const targets = String(list || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!targets.length) return { error: `Donne les agents à vérifier : --verifies ${role}:w1,w2.` };
    for (const id of targets) {
      if (id === selfId) return { error: `Un agent ne peut pas se vérifier lui-même (${id}).` };
      if (!orch.agents.some((a) => a.id === id)) return { error: `Agent inconnu dans la mission : ${id}.` };
    }
    missions.push({ role, targets: [...new Set(targets)] });
  }
  return { missions };
}

function mergeMissions(existing = [], added = []) {
  const byRole = new Map(existing.map((m) => [m.role, new Set(m.targets)]));
  for (const m of added) byRole.set(m.role, new Set([...(byRole.get(m.role) || []), ...m.targets]));
  return [...byRole].map(([role, targets]) => ({ role, targets: [...targets] }));
}

const missionText = (missions) => missions.map((m) => `${m.role}:${m.targets.join(',')}`).join(' ');

// What acceptLines needs to judge a line: the writer, its missions, every agent's pick, parents and deliveries, the records already stored.
function captureContext(orch, agent, records = []) {
  return {
    writer: pickOf(agent),
    missions: agent.missions || [],
    agents: Object.fromEntries(orch.agents.map((a) => [a.id, pickOf(a)])),
    parentOf: Object.fromEntries(orch.agents.filter((a) => a.parentId).map((a) => [a.id, a.parentId])),
    deliveries: Object.fromEntries(orch.agents.map((a) => [a.id, a.deliveries || 0])),
    records,
  };
}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

function verdictWakeLines(records = [], rejected = []) {
  const findings = new Map();
  const clean = [];
  let triages = 0;
  let ranks = 0;
  for (const r of records) {
    if (r.type === 'finding') findings.set(r.target.agent, (findings.get(r.target.agent) || 0) + 1);
    else if (r.type === 'clean') clean.push(r.target.agent);
    else if (r.type === 'triage') triages++;
    else if (r.type === 'rank') ranks++;
  }
  const parts = [...[...findings].map(([id, n]) => `${plural(n, 'constat', 'constats')} sur ${id}`), ...clean.map((id) => `${id} propre`)];
  if (triages) parts.push(plural(triages, 'triage', 'triages'));
  if (ranks) parts.push(plural(ranks, 'classement', 'classements'));
  const lines = [];
  if (parts.length) lines.push(`Verdicts : ${parts.join(', ')}`);
  for (const r of rejected) lines.push(`Ligne ignorée : ${String(r.reason).replace(/\s+/g, ' ').slice(0, 160)}`);
  return lines;
}

function outcomeRecord(agent, { outcome, note, measure = {} }) {
  return {
    id: `${agent.obs}:outcome`, type: 'outcome', pick: pickOf(agent), outcome: outcome ?? null, note: String(note || '').slice(0, 300),
    rounds: agent.rounds || 0, deliveries: agent.deliveries || 0, explore: !!agent.explore, tokens: measure.tokens ?? null, durationMs: measure.durationMs ?? null,
  };
}

function validateOutcome(outcome) {
  return OUTCOMES.includes(outcome) ? { outcome } : { error: 'Usage : orchestrate outcome <id> as-is|fixed|partial|redone ["note"]' };
}

module.exports = { MISSION_ROLES, OUTCOMES, FINAL_MESSAGE_MAX, RATE_REPLACED, newObs, pickOf, parseMissions, mergeMissions, missionText, captureContext, verdictWakeLines, outcomeRecord, validateOutcome };
