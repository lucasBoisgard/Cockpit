// Evidence-based verdicts, without I/O: the verdict envelope a verifying agent ends its final message with, the
// records it yields once checked against the agent's mission, and the scores out of 100 computed from them.
const ENVELOPE_OPEN = '<verdict-report v="1">';
const ENVELOPE_CLOSE = '</verdict-report>';
const TEXT_MAX = 300;
const ROLES = ['reviewer', 'challenger', 'judge', 'consumer'];
const SEVERITIES = ['blocking', 'to-fix', 'suggestion'];
const STATUSES = ['confirmed', 'false', 'plausible'];
const OUTCOMES = ['as-is', 'fixed', 'partial', 'redone'];

const SEVERITY_WEIGHT = { blocking: 10, 'to-fix': 1, suggestion: 0 };
const DECAY = 0.96;
const LEGACY_SCORE = { 1: 20, 2: 40, 3: 55, 4: 75, 5: 90 };
const OUTCOME_SCORE = { 'as-is': 80, fixed: 65, partial: 45, redone: 15 };
const OFF_MATRIX_REF = 55;
const PRIOR_WEIGHT = 3;
const UNVERIFIED_WEIGHT = 0.2;
const UNVERIFIED_CAP = 1.5;
const LEVEL_WEIGHT = { audited: 1, reviewed: 0.6, 'clean-unaudited': 0.3, evaluated: 1 };
const GOOD_ENOUGH = 70;
const VALUE_BAND = 10;
const VALUE_SAVING = 0.75;
const QUALITY_BAND = 3;
const COVERAGE_TARGET = 3;
const DOMINATED_GAP = 15;
const LAUNCHES_PER_CREDIT = 5;
const MAX_CREDITS = 2;
const RETAIN_DEFAULT = 5000;
const DUEL_MAX_MINUTES = 15;
const DUEL_MAX_WINDOW = 50;

const keyOf = (p) => `${p.category}|${p.provider}|${p.model}|${p.effort || ''}`;
const HOME_PREFIX = /(?:\/home\/[^/\s]+|\/Users\/[^/\s]+|\/root)\//g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const redactText = (text) => String(text ?? '').replace(HOME_PREFIX, '~/').replace(UUID, '…');
const clip = (s, n = TEXT_MAX) => String(s ?? '').trim().slice(0, n);
const pickOf = (p, role) => ({ obs: p.obs, agent: p.agent, category: p.category, provider: p.provider, model: p.model, effort: p.effort || '', ...(role ? { role } : {}) });
const weightOf = (severity) => SEVERITY_WEIGHT[severity] || 0;

function parseEnvelope(text) {
  const lines = String(text ?? '').split('\n').map((l) => l.replace(/\r$/, ''));
  let end = lines.length - 1;
  while (end >= 0 && !lines[end].trim()) end--;
  if (end < 0 || lines[end].trim() !== ENVELOPE_CLOSE) return null;
  let fence = null;
  let open = -1;
  let closeFence = null;
  lines.forEach((line, i) => {
    if (i === end) closeFence = fence;
    if (i >= end) return;
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (m) {
      if (!fence) fence = { ch: m[1][0], len: m[1].length };
      else if (fence.ch === m[1][0] && m[1].length >= fence.len && !m[2].trim()) fence = null;
      return;
    }
    if (!fence && line.trim() === ENVELOPE_OPEN && line.startsWith('<')) open = i;
  });
  if (open < 0 || closeFence) return null;
  if (lines.slice(open + 1, end).some((l) => l.trim() === ENVELOPE_CLOSE)) return null;
  const out = [];
  const errors = [];
  let target = null;
  for (const raw of lines.slice(open + 1, end)) {
    const line = raw.trim();
    if (!line) continue;
    let m;
    if ((m = /^on\s+([\w-]+)$/.exec(line))) target = m[1];
    else if (line === 'clean') {
      if (target) out.push({ kind: 'clean', target, raw: line });
      else errors.push({ line, reason: "ligne hors d'un bloc « on <agent> »" });
    } else if ((m = /^F(\d{1,9})\s+(blocking|to-fix|suggestion)((?:\s+[a-z]+=\S+)*)\s*:\s*(.*)$/.exec(line))) {
      if (!target) {
        errors.push({ line, reason: "ligne hors d'un bloc « on <agent> »" });
        continue;
      }
      const opts = {};
      let bad = null;
      for (const token of m[3].trim().split(/\s+/).filter(Boolean)) {
        const [k, val] = token.split('=');
        if (k === 'dup' && /^[\w-]+:F\d{1,9}$/.test(val) && !opts.dup) opts.dup = val;
        else if (k === 'missed' && /^[\w-]+$/.test(val) && !opts.missed) opts.missed = val;
        else bad = token;
      }
      if (bad) {
        errors.push({ line, reason: `option illisible : ${bad}` });
        continue;
      }
      out.push({ kind: 'finding', target, n: Number(m[1]), severity: m[2], ...opts, text: clip(m[4]), raw: line });
    } else if ((m = /^triage\s+([\w-]+):F(\d{1,9})\s+(confirmed|false|plausible)(?:\s+(blocking|to-fix|suggestion))?\s*(?::\s*(.*))?$/.exec(line))) {
      out.push({ kind: 'triage', agent: m[1], n: Number(m[2]), status: m[3], ...(m[4] ? { severity: m[4] } : {}), text: clip(m[5]), raw: line });
    } else if ((m = /^rank\s+([\w-]+)\s+(\d{1,6})\/(\d{1,6})$/.exec(line))) {
      out.push({ kind: 'rank', target: m[1], rank: Number(m[2]), of: Number(m[3]), raw: line });
    } else errors.push({ line, reason: 'ligne illisible' });
  }
  return { lines: out, errors };
}

// ctx: { writer: pick, missions: [{ role, targets: [agentId] }], agents: { agentId: pick }, parentOf: { agentId: parentId },
// deliveries: { agentId: n }, records: [...existing] }. Returns { accepted, rejected: [{ line, reason }], ignored }.
function acceptLines(lines, ctx) {
  const { writer, missions = [], agents = {}, parentOf = {}, deliveries = {}, records = [] } = ctx;
  const accepted = [];
  const rejected = [];
  let ignored = 0;
  const known = new Map(records.map((r) => [r.id, r]));
  const reject = (line, reason) => rejected.push({ line: line.raw, reason });
  const ancestors = new Set();
  for (let a = parentOf[writer.agent]; a && !ancestors.has(a); a = parentOf[a]) ancestors.add(a);
  const covering = (agentId, roles = ROLES) => missions.find((m) => roles.includes(m.role) && (m.targets || []).includes(agentId));
  const add = (rec) => {
    if (known.has(rec.id)) {
      ignored++;
      return null;
    }
    known.set(rec.id, rec);
    accepted.push(rec);
    return rec;
  };

  for (const line of lines) {
    if (line.kind === 'finding' || line.kind === 'clean' || line.kind === 'rank') {
      const target = agents[line.target];
      if (!target) {
        reject(line, `${line.target} est inconnu`);
        continue;
      }
      if (line.target === writer.agent) {
        reject(line, 'tu ne peux pas te juger toi-même');
        continue;
      }
      if (ancestors.has(line.target)) {
        reject(line, `${line.target} est ton parent`);
        continue;
      }
      const mission = covering(line.target, line.kind === 'rank' ? ['judge'] : ROLES);
      if (!mission) {
        reject(line, `${line.target} n'est pas dans ta mission`);
        continue;
      }
      const judge = pickOf(writer, mission.role);
      const delivery = deliveries[line.target] || 1;
      if (line.kind === 'clean') add({ type: 'clean', id: `${writer.obs}:clean:${target.obs}:${delivery}`, judge, target: pickOf(target), delivery });
      else if (line.kind === 'rank') {
        if (line.rank < 1 || line.rank > line.of) reject(line, 'rang hors de 1..n');
        else add({ type: 'rank', id: `${writer.obs}:rank:${target.obs}`, judge, target: pickOf(target), rank: line.rank, of: line.of });
      } else {
        const rec = { type: 'finding', id: `${writer.obs}:F${line.n}`, judge, target: pickOf(target), delivery, severity: line.severity, text: redactText(line.text) };
        if (line.dup) {
          const [dupAgent, dupN] = line.dup.split(':F');
          const original = known.get(`${agents[dupAgent]?.obs}:F${dupN}`);
          if (!original) {
            reject(line, `${line.dup} est inconnu`);
            continue;
          }
          if (original.target.obs !== target.obs || original.delivery !== delivery) {
            reject(line, `${line.dup} porte sur une autre livraison`);
            continue;
          }
          rec.dup = original.id;
        }
        if (line.missed) {
          const reviewer = line.missed === writer.agent || !covering(line.missed) ? null : agents[line.missed];
          const judged = reviewer && [...known.values()].some((r) => (r.type === 'finding' || r.type === 'clean') && r.judge.obs === reviewer.obs && r.target.obs === target.obs);
          if (!judged) {
            reject(line, `${line.missed} n'a pas jugé ${line.target}`);
            continue;
          }
          rec.missed = reviewer.obs;
        }
        add(rec);
      }
    } else if (line.kind === 'triage') {
      const owner = agents[line.agent];
      const finding = owner && known.get(`${owner.obs}:F${line.n}`);
      if (!finding || finding.type !== 'finding') {
        reject(line, `${line.agent}:F${line.n} est inconnu`);
        continue;
      }
      let role = null;
      if (finding.target.obs === writer.obs) role = 'author';
      else if (finding.judge.obs === writer.obs) {
        reject(line, 'tu ne peux pas te juger toi-même');
        continue;
      } else if (ancestors.has(finding.target.agent)) {
        reject(line, `${finding.target.agent} est ton parent`);
        continue;
      } else role = (covering(finding.target.agent) || covering(finding.judge.agent))?.role;
      if (!role) {
        reject(line, `${line.agent}:F${line.n} n'est pas dans ta mission`);
        continue;
      }
      add({ type: 'triage', id: `${writer.obs}:triage:${finding.id}`, finding: finding.id, by: pickOf(writer, role), status: line.status, ...(line.severity ? { severity: line.severity } : {}), text: redactText(line.text) });
    }
  }
  return { accepted, rejected, ignored };
}

// Every finding with how its triage settled it: state (false | confirmed | admitted | contested | untriaged), the
// severity that applies, whether it duplicates another one of the same delivery, and whether it counts.
function resolveFindings(records) {
  const findings = records.filter((r) => r.type === 'finding');
  const triages = new Map();
  for (const t of records) if (t.type === 'triage') triages.set(t.finding, [...(triages.get(t.finding) || []), t]);
  const resolved = findings.map((f) => {
    const list = triages.get(f.id) || [];
    const indep = list.filter((t) => t.by.role !== 'author' && t.status !== 'plausible').pop();
    const author = list.filter((t) => t.by.role === 'author' && t.status !== 'plausible').pop();
    let state = 'untriaged';
    let severity = f.severity;
    if (indep) {
      state = indep.status === 'false' ? 'false' : 'confirmed';
      if (indep.status === 'confirmed' && indep.severity) severity = indep.severity;
    } else if (author) state = author.status === 'confirmed' ? 'admitted' : 'contested';
    return { ...f, state, effSeverity: severity, counts: state !== 'false' && severity !== 'suggestion' };
  });
  const base = new Map(resolved.map((f) => [f.id, f]));
  const sameDefect = (f) => {
    const original = f.dup && base.get(f.dup);
    return original && original.target.obs === f.target.obs && original.delivery === f.delivery ? original : null;
  };
  const keeper = new Map();
  for (const f of resolved) {
    const original = sameDefect(f);
    if (!original || original.counts || !f.counts) continue;
    const current = keeper.get(original.id);
    if (!current || weightOf(f.effSeverity) > weightOf(current.effSeverity)) keeper.set(original.id, f);
  }
  return resolved.map((f) => {
    const original = sameDefect(f);
    const isDup = !!original && (original.counts || keeper.get(original.id) !== f);
    return { ...f, isDup, counts: f.counts && !isDup };
  });
}

const countedFindings = (records) => resolveFindings(records).filter((f) => f.counts);

const workScore = (counted) => Math.round(100 * DECAY ** counted.reduce((d, f) => d + weightOf(f.effSeverity), 0));

function reviewerScore(C, F, M) {
  return Math.round(100 * ((C + 1) / (C + F + 1)) * ((C + 1) / (C + M + 1)));
}

const isTriaged = (f) => f.state === 'confirmed' || f.state === 'admitted' || f.state === 'false';

// One observation per judged or outcome-reported agent: { obs, agent, key, pick, kind, level, weight, score, ... }.
function observationScores(records) {
  const resolved = resolveFindings(records);
  const picks = new Map();
  const note = (p) => {
    if (p && !picks.has(p.obs)) picks.set(p.obs, pickOf(p));
  };
  const outcomes = new Map();
  const verdictsOf = new Map();
  const ranksOf = new Map();
  const push = (map, key, value) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(value);
  };
  records.forEach((r, idx) => {
    if (r.type === 'outcome') {
      note(r.pick || r);
      outcomes.set((r.pick || r).obs, r);
      return;
    }
    if (r.type !== 'finding' && r.type !== 'clean' && r.type !== 'rank') return;
    note(r.target);
    note(r.judge);
    push(r.type === 'rank' ? ranksOf : verdictsOf, r.target.obs, { judge: r.judge, idx });
  });
  const findingsOfTarget = new Map();
  const findingsOfJudge = new Map();
  const missedBy = new Map();
  for (const f of resolved) {
    push(findingsOfTarget, f.target.obs, f);
    push(findingsOfJudge, f.judge.obs, f);
    if (f.missed && !f.isDup && f.state !== 'false') missedBy.set(f.missed, (missedBy.get(f.missed) || 0) + weightOf(f.effSeverity));
  }
  const result = [];

  const targets = new Set([...verdictsOf.keys(), ...ranksOf.keys(), ...outcomes.keys()]);
  for (const obs of targets) {
    const pick = picks.get(obs);
    if (!pick || pick.category === 'review') continue;
    const mine = [...(verdictsOf.get(obs) || []), ...(ranksOf.get(obs) || [])];
    const findings = findingsOfTarget.get(obs) || [];
    const judges = [...new Map(mine.map((r) => [r.judge.obs, r.judge])).values()];
    if (mine.length) {
      const arena = judges.some((j) => j.role === 'judge');
      let level;
      if (findings.some(isTriaged) || judges.length >= 2 || arena) level = 'audited';
      else if (findings.length) level = 'reviewed';
      else level = 'clean-unaudited';
      const counted = findings.filter((f) => f.counts);
      result.push({
        obs, agent: pick.agent, key: keyOf(pick), pick, kind: 'work', level, weight: LEVEL_WEIGHT[level], score: workScore(counted),
        counted: counted.length, contested: findings.filter((f) => f.state === 'contested').length, judges, findings: counted.map((f) => f.id),
      });
    } else {
      const o = outcomes.get(obs);
      if (OUTCOME_SCORE[o.outcome] !== undefined) {
        result.push({ obs, agent: pick.agent, key: keyOf(pick), pick, kind: 'work', level: 'outcome', weight: UNVERIFIED_WEIGHT, score: OUTCOME_SCORE[o.outcome], outcome: o.outcome, counted: 0, contested: 0, judges: [], findings: [] });
      }
    }
  }

  const reviewers = new Set();
  for (const list of verdictsOf.values()) for (const e of list) reviewers.add(e.judge.obs);
  for (const obs of reviewers) {
    const pick = picks.get(obs);
    if (!pick || pick.category !== 'review') continue;
    const own = findingsOfJudge.get(obs) || [];
    let laterVerifier = false;
    for (const list of verdictsOf.values()) {
      const first = list.find((e) => e.judge.obs === obs);
      if (first && list.some((e) => e.judge.obs !== obs && e.idx > first.idx)) laterVerifier = true;
    }
    if (!own.some(isTriaged) && !laterVerifier) continue;
    let C = 0;
    let F = 0;
    for (const f of own) {
      if (f.state === 'confirmed' || f.state === 'admitted') C += weightOf(f.effSeverity);
      else if (f.state === 'false') F += weightOf(f.severity);
    }
    const M = missedBy.get(obs) || 0;
    result.push({
      obs, agent: pick.agent, key: keyOf(pick), pick, kind: 'reviewer', level: 'evaluated', weight: LEVEL_WEIGHT.evaluated, score: reviewerScore(C, F, M),
      C, F, M, counted: 0, contested: own.filter((f) => f.state === 'contested').length, judges: [], findings: own.map((f) => f.id),
    });
  }
  return result;
}

const legacyObservation = (r) => ({
  obs: null, agent: r.agent ?? null, key: keyOf(r), pick: pickOf(r), kind: 'work', level: 'legacy', weight: UNVERIFIED_WEIGHT, score: LEGACY_SCORE[r.score], legacyScore: r.score,
});

function confidence(V) {
  if (V < 1) return 'à éprouver';
  if (V < 3) return 'faible';
  if (V < 6) return 'moyenne';
  return 'solide';
}

// ref is 0-100. Unverified evidence (outcomes and legacy ratings together) weighs at most UNVERIFIED_CAP, spread evenly.
function scoreFromObservations(ref, observations = []) {
  const unverified = observations.filter((o) => o.level === 'outcome' || o.level === 'legacy');
  const verified = observations.filter((o) => o.level !== 'outcome' && o.level !== 'legacy');
  const V = Math.round(verified.reduce((s, o) => s + o.weight, 0) * 1000) / 1000;
  const wu = Math.min(UNVERIFIED_CAP, UNVERIFIED_WEIGHT * unverified.length);
  const mean = unverified.length ? unverified.reduce((s, o) => s + o.score, 0) / unverified.length : 0;
  const raw = (PRIOR_WEIGHT * ref + verified.reduce((s, o) => s + o.weight * o.score, 0) + wu * mean) / (PRIOR_WEIGHT + V + wu);
  return { S: Math.round(raw), raw, V, confidence: confidence(V), verified: verified.length };
}

const refScore = (ref) => (LEGACY_SCORE[ref] !== undefined ? LEGACY_SCORE[ref] : OFF_MATRIX_REF);

const median = (values) => {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

// legacy: the frozen 1-5 ratings, [{ category, provider, model, effort, score }].
// refOf(pick) returns the pick's matrix score (1-5) or null for an off-matrix pick. Returns { [key]: entry }.
function pickScores(records, legacy = [], refOf = () => null) {
  const groups = new Map();
  const group = (p) => {
    const key = keyOf(p);
    if (!groups.has(key)) groups.set(key, { key, ...pickOf(p), observations: [], outcomes: {}, rounds: [], ranks: [], legacy: [] });
    return groups.get(key);
  };
  for (const o of observationScores(records)) group(o.pick).observations.push(o);
  for (const r of legacy) if (LEGACY_SCORE[r.score] !== undefined) {
    const g = group(r);
    g.observations.push(legacyObservation(r));
    g.legacy.push(r.score);
  }
  const latestOutcome = new Map();
  for (const r of records) if (r.type === 'outcome') latestOutcome.set((r.pick || r).obs, r);
  for (const r of latestOutcome.values()) {
    const g = group(r.pick || r);
    const k = r.outcome === null || r.outcome === undefined ? 'none' : r.outcome;
    g.outcomes[k] = (g.outcomes[k] || 0) + 1;
    if (Number.isFinite(r.rounds)) g.rounds.push(r.rounds);
  }
  for (const r of records) if (r.type === 'rank') group(r.target).ranks.push({ rank: r.rank, of: r.of });
  const out = {};
  for (const [key, g] of groups) {
    delete g.obs;
    delete g.agent;
    const ref = refScore(refOf(g));
    const s = scoreFromObservations(ref, g.observations);
    out[key] = {
      ...g, ref, ...s, medianRounds: median(g.rounds),
      legacyAvg: g.legacy.length ? g.legacy.reduce((a, b) => a + b, 0) / g.legacy.length : null,
    };
  }
  return out;
}

// Keeps at most `max` observed agents (those that are the target of a record or have an outcome), dropping the
// oldest with every record that references them, then whatever depended on a dropped record.
function retain(records, max = RETAIN_DEFAULT) {
  const order = [];
  const seen = new Set();
  for (const r of records) {
    const p = r.type === 'outcome' ? r.pick || r : r.target;
    if (p && p.obs && !seen.has(p.obs)) {
      seen.add(p.obs);
      order.push(p.obs);
    }
  }
  if (order.length <= max) return records;
  const dropped = new Set(order.slice(0, order.length - max));
  const droppedIds = new Set();
  let kept = records;
  for (let changed = true; changed;) {
    changed = false;
    const next = kept.filter((r) => {
      const p = r.type === 'outcome' ? r.pick || r : null;
      const bad = (p && dropped.has(p.obs))
        || (r.target && dropped.has(r.target.obs)) || (r.judge && dropped.has(r.judge.obs)) || (r.by && dropped.has(r.by.obs))
        || (r.missed && dropped.has(r.missed)) || (r.dup && droppedIds.has(r.dup)) || (r.finding && droppedIds.has(r.finding));
      if (bad && !droppedIds.has(r.id)) {
        droppedIds.add(r.id);
        changed = true;
      }
      return !bad;
    });
    kept = next;
  }
  return kept;
}

// picks: [{ key, S, available, quotaCost, durationMs }]. Value categories and `rankBy: "quality"` differ in the band. On value, a
// good-enough pick may lead when it is within VALUE_BAND points of the best score, or further behind but really cheaper (at most
// VALUE_SAVING of the best-scored pick's cost): a few tokens saved never buy a much weaker pick. The band is anchored on the
// cheapest of the best-scored picks, so the order cannot cycle nor depend on the keys.
function orderPicks(picks, rankBy) {
  const cost = (p) => (Number.isFinite(p.quotaCost) ? p.quotaCost : Infinity);
  const dur = (p) => (Number.isFinite(p.durationMs) ? p.durationMs : Infinity);
  const byKey = (a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  const sOf = (p) => (Number.isFinite(p.S) ? p.S : 0);
  const bySdesc = (a, b) => sOf(b) - sOf(a) || byKey(a, b);
  const cheap = (a, b) => cost(a) - cost(b) || dur(a) - dur(b) || bySdesc(a, b);
  const available = picks.filter((p) => p.available !== false);
  const unavailable = picks.filter((p) => p.available === false).sort(bySdesc);
  const best = available.length ? Math.max(...available.map(sOf)) : 0;
  const top = available.filter((p) => sOf(p) === best).sort(cheap)[0];
  const worthIt = (p) => sOf(p) >= best - VALUE_BAND || (Number.isFinite(cost(top)) && cost(p) <= cost(top) * VALUE_SAVING);
  const inBand = (p) => (rankBy === 'quality' ? sOf(p) >= best - QUALITY_BAND : sOf(p) >= GOOD_ENOUGH && worthIt(p));
  const band = available.filter(inBand).sort(cheap);
  const rest = available.filter((p) => !inBand(p)).sort(bySdesc);
  return [...band, ...rest, ...unavailable];
}

const coverageOf = (c) => ({ launches: c?.launches || 0, credits: c?.credits || 0, spent: c?.spent || 0 });

function addLaunch(coverage) {
  const c = coverageOf(coverage);
  const launches = c.launches + 1;
  return { ...c, launches, credits: launches % LAUNCHES_PER_CREDIT === 0 ? Math.min(MAX_CREDITS, c.credits + 1) : c.credits };
}

function spendCredit(coverage) {
  const c = coverageOf(coverage);
  return c.credits > 0 ? { ...c, credits: c.credits - 1, spent: c.spent + 1 } : c;
}

// category: { rankBy? }. picks: [{ key, ref (1-5), available, V, S, quotaCost }]. Returns { pick, mode } or null.
function coverageCandidate(category, picks, coverage) {
  if (coverageOf(coverage).credits < 1) return null;
  const available = picks.filter((p) => p.available !== false);
  if (!available.length) return null;
  const cost = (p) => (Number.isFinite(p.quotaCost) ? p.quotaCost : Infinity);
  const best = available.reduce((a, b) => (b.S > a.S ? b : a));
  const dominated = (p) => p.V >= COVERAGE_TARGET && p.S <= best.S - DOMINATED_GAP && cost(p) >= cost(best);
  const pool = available.filter((p) => (p.ref ?? 0) >= 3);
  const live = pool.filter((p) => !dominated(p));
  const eligible = live.some((p) => p.V < COVERAGE_TARGET) ? live : pool;
  if (!eligible.length) return null;
  eligible.sort((a, b) => a.V - b.V || cost(a) - cost(b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { pick: eligible[0], mode: category?.rankBy === 'quality' ? 'duel' : 'explore' };
}

// A duel only runs on a short task, never for a sub-orchestrator, while the candidate provider's 7-day window is under 50 %.
const duelAllowed = ({ timeBudgetMin, windowPct, subOrchestrator } = {}) =>
  !subOrchestrator && Number.isFinite(timeBudgetMin) && timeBudgetMin <= DUEL_MAX_MINUTES && Number.isFinite(windowPct) && windowPct < DUEL_MAX_WINDOW;

module.exports = {
  ROLES, SEVERITIES, STATUSES, OUTCOMES, LEGACY_SCORE, OUTCOME_SCORE, GOOD_ENOUGH, VALUE_BAND, VALUE_SAVING, COVERAGE_TARGET,
  parseEnvelope, acceptLines, redactText, resolveFindings, countedFindings, observationScores, scoreFromObservations, pickScores,
  confidence, retain, orderPicks, coverageCandidate, addLaunch, spendCredit, duelAllowed, keyOf, refScore,
};
