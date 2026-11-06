const { emptyTotals, addTotals, totalOf } = require('./usage');

const providerOf = (p) => (p === 'codex' ? 'codex' : 'claude');
const effortOf = (e) => e || null;

function agentRows(orch, usageOf) {
  const byParent = new Map();
  for (const a of orch.agents || []) {
    const key = a.parentId && orch.agents.some((p) => p.id === a.parentId) ? a.parentId : '';
    byParent.set(key, [...(byParent.get(key) || []), a]);
  }
  const rows = [];
  const walk = (parentId, depth) => {
    for (const a of byParent.get(parentId) || []) {
      const u = a.sessionId ? usageOf.get(a.sessionId) : null;
      rows.push({
        id: a.id, name: a.name, job: orch.job || 1, depth, parentId: a.parentId || null, role: 'agent',
        provider: providerOf(a.provider), model: a.model || null, effort: effortOf(a.effort), kind: a.kind || null, rating: a.rating?.score ?? null,
        totals: u ? u.totals : null, costUsd: u?.costUsd ?? null,
        sessionId: a.sessionId || null, startedAt: a.createdAt || null, endedAt: a.stoppedAt || null,
      });
      walk(a.id, depth + 1);
    }
  };
  walk('', 1);
  return rows;
}

// One group per master session: the master, its agents at every depth and all its jobs (current and archived).
// `store`: orchestrations by key. `usageOf`: Map sessionId → { totals, costUsd }.
function groupOrchestrations(store, usageOf, now) {
  const groups = new Map();
  for (const orch of Object.values(store || {})) {
    const master = orch.masterSessionId;
    if (!master) continue;
    if (!groups.has(master)) groups.set(master, []);
    groups.get(master).push(orch);
  }
  const out = [];
  for (const [master, jobs] of groups) {
    jobs.sort((a, b) => (a.job || 1) - (b.job || 1));
    const latest = jobs[jobs.length - 1];
    const masterUsage = usageOf.get(master) || null;
    const rows = jobs.flatMap((orch) => agentRows(orch, usageOf));
    const masterRow = {
      id: 'master', name: 'Maître', job: null, depth: 0, parentId: null, role: 'master',
      provider: 'claude', model: latest.model || null, effort: effortOf(latest.effort), kind: null, rating: null,
      totals: masterUsage ? masterUsage.totals : null, costUsd: masterUsage?.costUsd ?? null, sessionId: master, startedAt: jobs[0].createdAt || null, endedAt: null,
    };
    const all = [masterRow, ...rows];
    const totals = emptyTotals();
    const byProvider = { claude: 0, codex: 0 };
    const models = new Map();
    let costUsd = null;
    for (const r of all) {
      if (r.totals) {
        addTotals(totals, r.totals);
        const n = totalOf(r.totals);
        byProvider[r.provider] += n;
        const key = `${r.provider}|${r.model || ''}|${r.effort || ''}`;
        const m = models.get(key) || { provider: r.provider, model: r.model, effort: r.effort, tokens: 0, agents: 0 };
        m.tokens += n;
        m.agents += 1;
        models.set(key, m);
      }
      if (r.costUsd != null) costUsd = (costUsd || 0) + r.costUsd;
    }
    const wallMs = jobs.reduce((n, o) => n + Math.max(0, (o.endedAt ?? now) - (o.createdAt ?? now)), 0);
    out.push({
      masterSessionId: master,
      worktree: latest.worktree || null,
      goal: latest.goal || '',
      active: jobs.some((o) => !o.endedAt),
      jobs: jobs.map((o) => ({ job: o.job || 1, goal: o.goal || '', startedAt: o.createdAt || null, endedAt: o.endedAt || null })),
      agentCount: rows.length,
      totals,
      tokens: totalOf(totals),
      byProvider,
      costUsd,
      wallMs,
      models: [...models.values()].sort((a, b) => b.tokens - a.tokens),
      rows: all,
      withoutUsage: all.filter((r) => !r.totals).length,
      at: Math.max(...jobs.map((o) => o.endedAt || o.createdAt || 0), now && jobs.some((o) => !o.endedAt) ? now : 0),
    });
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || b.at - a.at);
}

module.exports = { groupOrchestrations };
