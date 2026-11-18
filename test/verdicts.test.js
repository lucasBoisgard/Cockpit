const test = require('node:test');
const assert = require('node:assert/strict');
const v = require('../server/core/verdicts');

const pick = (agent, category = 'implement', extra = {}) => ({ obs: `obs-${agent}`, agent, category, provider: 'claude', model: 'sonnet', effort: 'medium', ...extra });
const reviewer = (agent) => pick(agent, 'review', { effort: 'low' });
const J = (p, role = 'reviewer') => ({ ...p, role });

let seq = 0;
const finding = (judge, target, severity, extra = {}) => ({ type: 'finding', id: `${judge.obs}:F${++seq}`, judge: J(judge), target, delivery: 1, severity, text: 't', ...extra });
const triage = (f, by, status, role, severity) => ({ type: 'triage', id: `${by.obs}:triage:${f.id}`, finding: f.id, by: J(by, role), status, ...(severity ? { severity } : {}), text: '' });
const admit = (f) => triage(f, f.target, 'confirmed', 'author');
const clean = (judge, target, delivery = 1) => ({ type: 'clean', id: `${judge.obs}:clean:${target.obs}:${delivery}`, judge: J(judge), target, delivery });

const envelope = (body) => `Done.\n\n<verdict-report v="1">\n${body}\n</verdict-report>\n`;

test('parseEnvelope reads the trailing envelope', () => {
  const r = v.parseEnvelope(envelope('on w1\nF1 blocking: crash (a.js:1)\nF2 to-fix dup=w10:F3 missed=w8: slow\nF3 suggestion: nit\non w2\nclean\ntriage w8:F5 false: not real\ntriage w8:F2 confirmed suggestion\nrank w21 1/3'));
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.lines.map((l) => l.kind), ['finding', 'finding', 'finding', 'clean', 'triage', 'triage', 'rank']);
  assert.equal(r.lines[1].dup, 'w10:F3');
  assert.equal(r.lines[1].missed, 'w8');
  assert.equal(r.lines[3].target, 'w2');
  assert.equal(r.lines[5].severity, 'suggestion');
  assert.deepEqual([r.lines[6].rank, r.lines[6].of], [1, 3]);
});

test('parseEnvelope ignores quotes, fences and non-terminal envelopes', () => {
  const body = '<verdict-report v="1">\non w1\nclean\n</verdict-report>';
  assert.equal(v.parseEnvelope(`${body}\nmore text`), null);
  assert.equal(v.parseEnvelope('```\n' + body + '\n```'), null);
  assert.equal(v.parseEnvelope('> ' + body.split('\n').join('\n> ')), null);
  assert.equal(v.parseEnvelope('no envelope'), null);
  const real = v.parseEnvelope(`Example:\n\`\`\`\n${body}\n\`\`\`\n${envelope('on w9\nclean')}`);
  assert.deepEqual(real.lines.map((l) => l.target), ['w9']);
});

test('parseEnvelope reports malformed lines and lines before any target', () => {
  const r = v.parseEnvelope(envelope('clean\nwhat is this\non w1\nF1 huge: x'));
  assert.equal(r.lines.length, 0);
  assert.equal(r.errors.length, 3);
});

const w1 = pick('w1');
const w2 = pick('w2');
const rv = reviewer('w8');
const ctxOf = (writer, missions, extra = {}) => ({
  writer, missions, agents: { w1, w2, w8: rv, w5: reviewer('w5'), w10: reviewer('w10') }, parentOf: {}, deliveries: { w1: 1, w2: 1 }, records: [], ...extra,
});
const parse = (body) => v.parseEnvelope(envelope(body)).lines;

test('acceptLines needs a mission covering the target', () => {
  const r = v.acceptLines(parse('on w1\nF1 to-fix: x\non w2\nclean'), ctxOf(rv, [{ role: 'reviewer', targets: ['w1'] }]));
  assert.equal(r.accepted.length, 1);
  assert.equal(r.accepted[0].id, 'obs-w8:F1');
  assert.equal(r.accepted[0].judge.role, 'reviewer');
  assert.equal(r.rejected[0].reason, "w2 n'est pas dans ta mission");
});

test('acceptLines rejects self, parents, unknown ids and non judge ranks', () => {
  const ctx = ctxOf(w1, [{ role: 'reviewer', targets: ['w1', 'w2', 'w9'] }], { parentOf: { w1: 'w2' } });
  const r = v.acceptLines(parse('on w1\nclean\non w2\nclean\non w9\nclean\nrank w2 1/2'), ctx);
  assert.equal(r.accepted.length, 0);
  assert.equal(r.rejected.length, 4);
  assert.match(r.rejected[0].reason, /toi-même/);
  assert.match(r.rejected[1].reason, /parent/);
  assert.match(r.rejected[2].reason, /inconnu/);
});

test('acceptLines stores a rank only for a judge mission', () => {
  const ok = v.acceptLines(parse('rank w1 1/2'), ctxOf(rv, [{ role: 'judge', targets: ['w1'] }]));
  assert.equal(ok.accepted[0].type, 'rank');
  const ko = v.acceptLines(parse('rank w1 1/2'), ctxOf(rv, [{ role: 'reviewer', targets: ['w1'] }]));
  assert.equal(ko.rejected.length, 1);
});

test('acceptLines is idempotent', () => {
  const ctx = ctxOf(rv, [{ role: 'reviewer', targets: ['w1'] }]);
  const first = v.acceptLines(parse('on w1\nF1 to-fix: x\nclean'), ctx);
  const again = v.acceptLines(parse('on w1\nF1 to-fix: x\nclean'), { ...ctx, records: first.accepted });
  assert.equal(again.accepted.length, 0);
  assert.equal(again.ignored, 2);
});

test('acceptLines handles dup and missed', () => {
  const base = v.acceptLines(parse('on w1\nF1 to-fix: x'), ctxOf(rv, [{ role: 'reviewer', targets: ['w1'] }])).accepted;
  const w10 = reviewer('w10');
  const ctx = ctxOf(w10, [{ role: 'reviewer', targets: ['w1', 'w8', 'w5'] }], { records: base });
  const ok = v.acceptLines(parse('on w1\nF1 to-fix dup=w8:F1 missed=w8: same'), ctx);
  assert.equal(ok.accepted[0].dup, 'obs-w8:F1');
  assert.equal(ok.accepted[0].missed, 'obs-w8');
  const newDelivery = v.acceptLines(parse('on w1\nF1 to-fix dup=w8:F1: same'), { ...ctx, deliveries: { w1: 2 } });
  assert.match(newDelivery.rejected[0].reason, /autre livraison/);
  const badMissed = v.acceptLines(parse('on w1\nF1 to-fix missed=w5: x'), ctx);
  assert.match(badMissed.rejected[0].reason, /n'a pas jugé/);
});

test('acceptLines triage: author, mission, outsider, own finding', () => {
  const f = v.acceptLines(parse('on w1\nF1 to-fix: x'), ctxOf(rv, [{ role: 'reviewer', targets: ['w1'] }])).accepted;
  const author = v.acceptLines(parse('triage w8:F1 confirmed'), ctxOf(w1, [], { records: f }));
  assert.equal(author.accepted[0].by.role, 'author');
  const challenger = v.acceptLines(parse('triage w8:F1 false: no'), ctxOf(reviewer('w5'), [{ role: 'challenger', targets: ['w8'] }], { records: f }));
  assert.equal(challenger.accepted[0].by.role, 'challenger');
  const outsider = v.acceptLines(parse('triage w8:F1 false'), ctxOf(reviewer('w5'), [], { records: f }));
  assert.match(outsider.rejected[0].reason, /mission/);
  const own = v.acceptLines(parse('triage w8:F1 false'), ctxOf(rv, [{ role: 'reviewer', targets: ['w1'] }], { records: f }));
  assert.match(own.rejected[0].reason, /toi-même/);
});

test('counting rules: suggestion, dup, independent false, contest, plausible, residual', () => {
  const j = reviewer('w8');
  const t = pick('t');
  const fs = [finding(j, t, 'to-fix'), finding(j, t, 'suggestion'), finding(j, t, 'to-fix'), finding(j, t, 'to-fix'), finding(j, t, 'to-fix')];
  fs.push(finding(j, t, 'to-fix', { dup: fs[0].id }));
  fs.push(finding(j, t, 'to-fix', { delivery: 2 }));
  const records = [...fs, triage(fs[2], reviewer('c'), 'false', 'challenger'), triage(fs[3], t, 'false', 'author'), triage(fs[4], reviewer('c'), 'plausible', 'challenger')];
  const counted = v.countedFindings(records).map((f) => f.id);
  assert.deepEqual(counted, [fs[0].id, fs[3].id, fs[4].id, fs[6].id]);
  const states = Object.fromEntries(v.resolveFindings(records).map((f) => [f.id, f.state]));
  assert.equal(states[fs[3].id], 'contested');
  assert.equal(states[fs[4].id], 'untriaged');
});

test('an independent triage replaces the severity and settles a contest', () => {
  const j = reviewer('w8');
  const t = pick('t');
  const f = finding(j, t, 'blocking');
  const [r] = v.resolveFindings([f, triage(f, t, 'false', 'author'), triage(f, reviewer('c'), 'confirmed', 'challenger', 'to-fix')]);
  assert.equal(r.state, 'confirmed');
  assert.equal(r.effSeverity, 'to-fix');
});

const score = (records, obs) => v.observationScores(records).find((o) => o.obs === obs);

test('work scores: blocking, to-fix, clean', () => {
  const t = pick('t');
  const j = reviewer('j');
  const one = (...sev) => v.observationScores(sev.map((s) => finding(j, t, s))).find((o) => o.obs === t.obs).score;
  assert.equal(one('blocking'), 66);
  assert.equal(one('blocking', 'to-fix', 'to-fix', 'to-fix'), 59);
  assert.equal(one('to-fix', 'to-fix', 'to-fix'), 88);
  assert.equal(one('suggestion'), 100);
  assert.equal(score([clean(j, t)], t.obs).score, 100);
});

test('levels and weights', () => {
  const t = pick('t');
  const j = reviewer('j');
  const j2 = reviewer('j2');
  assert.equal(score([clean(j, t)], t.obs).level, 'clean-unaudited');
  assert.equal(score([clean(j, t)], t.obs).weight, 0.3);
  const f = finding(j, t, 'to-fix');
  assert.deepEqual([score([f], t.obs).level, score([f], t.obs).weight], ['reviewed', 0.6]);
  assert.equal(score([f, admit(f)], t.obs).level, 'audited');
  assert.equal(score([f, triage(f, j2, 'plausible', 'challenger')], t.obs).level, 'reviewed');
  assert.equal(score([f, clean(j2, t)], t.obs).level, 'audited');
  const arena = { ...clean(j, t), judge: J(j, 'judge') };
  assert.equal(score([arena], t.obs).level, 'audited');
  const o = { type: 'outcome', id: 'obs-t:outcome', ...t, outcome: 'fixed' };
  assert.deepEqual([score([o], t.obs).level, score([o], t.obs).score, score([o], t.obs).weight], ['outcome', 65, 0.2]);
  assert.equal(score([clean(j, t), o], t.obs).level, 'clean-unaudited');
});

test('reviewer scores follow the formula and need evidence', () => {
  const j = reviewer('j');
  const t = pick('t');
  const rev = (...recs) => v.observationScores(recs).find((o) => o.obs === j.obs);
  const falses = [1, 2, 3].map(() => finding(j, t, 'to-fix'));
  assert.equal(rev(...falses, ...falses.map((f) => triage(f, reviewer('c'), 'false', 'challenger'))).score, 25);
  const one = finding(j, t, 'to-fix');
  assert.equal(rev(one, triage(one, reviewer('c'), 'false', 'challenger')).score, 50);
  assert.equal(rev(one), undefined);
  assert.equal(rev(one, triage(one, t, 'false', 'author')), undefined);
  const later = reviewer('later');
  const missed = finding(later, t, 'blocking', { missed: j.obs });
  assert.equal(rev(clean(j, t), missed).score, 9);
  assert.equal(rev(clean(j, t), clean(later, t)).score, 100);
  assert.equal(rev(one, admit(one)).level, 'evaluated');
});

test('pick scores: prior, shrinkage, unverified cap, confidence', () => {
  const ref = () => 4;
  const t = pick('t');
  const j = reviewer('j');
  const perfect = [clean(j, t), clean(reviewer('k'), t)];
  const s = v.pickScores(perfect, [], ref)[v.keyOf(t)];
  assert.equal(s.S, 81);
  assert.equal(s.confidence, 'faible');
  const outcomes = Array.from({ length: 20 }, (_, i) => ({ type: 'outcome', id: `o${i}`, ...pick(`o${i}`), outcome: 'as-is' }));
  const u = v.pickScores(outcomes, [], ref)[v.keyOf(pick('x'))];
  assert.equal(u.S, 77);
  assert.equal(u.V, 0);
  assert.equal(u.confidence, 'à éprouver');
  assert.equal(v.pickScores([], [{ ...pick('x'), score: 5 }], () => null)[v.keyOf(pick('x'))].ref, 55);
  assert.equal(v.confidence(0.9), 'à éprouver');
  assert.equal(v.confidence(1), 'faible');
  assert.equal(v.confidence(3), 'moyenne');
  assert.equal(v.confidence(6), 'solide');
});

test('retain drops the oldest observations with their dependants', () => {
  const j = reviewer('j');
  const a = pick('a');
  const b = pick('b');
  const c = pick('c');
  const fa = finding(j, a, 'to-fix');
  const fb = finding(j, b, 'to-fix');
  const dupOfA = finding(j, c, 'to-fix', { dup: fa.id });
  const missedA = finding(reviewer('k'), c, 'to-fix', { missed: a.obs });
  const records = [fa, triage(fa, a, 'confirmed', 'author'), fb, clean(j, c), dupOfA, missedA, { type: 'outcome', id: 'obs-a:outcome', ...a, outcome: 'as-is' }];
  assert.equal(v.retain(records, 5), records);
  const kept = v.retain(records, 2).map((r) => r.id);
  assert.deepEqual(kept, [fb.id, clean(j, c).id]);
});

test('order: value band by cost, quality band anchored on the top, no cycle', () => {
  const p = (key, S, quotaCost, durationMs, extra = {}) => ({ key, S, quotaCost, durationMs, ...extra });
  const picks = [p('a', 90, 10, 5), p('b', 75, 1, 9), p('c', 71, 2, 1), p('d', 60, 0, 0), p('e', 95, 0, 0, { available: false })];
  assert.deepEqual(v.orderPicks(picks, undefined).map((x) => x.key), ['b', 'c', 'a', 'd', 'e']);
  const near = [p('a', 85, 10, 5), p('b', 75, 2, 9), p('c', 80, 2, 3), p('d', 60, 0, 0)];
  assert.deepEqual(v.orderPicks(near, undefined).map((x) => x.key), ['c', 'b', 'a', 'd']);
  const q = [p('a', 90, 10, 5), p('b', 88, 1, 9), p('c', 86, 0, 0), p('d', 70, 0, 0)];
  assert.deepEqual(v.orderPicks(q, 'quality').map((x) => x.key), ['b', 'a', 'c', 'd']);
  const first = v.orderPicks(q, 'quality');
  assert.deepEqual(v.orderPicks([...first].reverse(), 'quality').map((x) => x.key), first.map((x) => x.key));
});

test('coverage: credits, candidate, dominated, duel gate', () => {
  let c = { launches: 0, credits: 0, spent: 0 };
  for (let i = 0; i < 4; i++) c = v.addLaunch(c);
  assert.equal(c.credits, 0);
  c = v.addLaunch(c);
  assert.equal(c.credits, 1);
  for (let i = 0; i < 15; i++) c = v.addLaunch(c);
  assert.equal(c.credits, 2);
  assert.deepEqual(v.spendCredit(c), { launches: 20, credits: 1, spent: 1 });
  assert.equal(v.addLaunch(null).launches, 1);

  const p = (key, ref, V, S, quotaCost, extra = {}) => ({ key, ref, V, S, quotaCost, ...extra });
  const picks = [p('a', 4, 5, 80, 5), p('b', 4, 1, 70, 3), p('c', 4, 0, 70, 9), p('d', 2, 0, 50, 1), p('e', 4, 0, 70, 1, { available: false }), p('f', 4, 4, 60, 9)];
  assert.equal(v.coverageCandidate({}, picks, { credits: 0 }), null);
  assert.deepEqual(v.coverageCandidate({}, picks, { credits: 1 }), { pick: picks[2], mode: 'explore' });
  assert.equal(v.coverageCandidate({ rankBy: 'quality' }, picks, { credits: 1 }).mode, 'duel');
  const covered = [p('a', 4, 5, 80, 5), p('f', 4, 4, 60, 9), p('g', 4, 6, 78, 2)];
  assert.equal(v.coverageCandidate({}, covered, { credits: 1 }).pick.key, 'f');
  const dom = [p('a', 4, 5, 80, 5), p('f', 4, 3, 60, 9), p('b', 4, 2, 79, 1)];
  assert.equal(v.coverageCandidate({}, dom, { credits: 1 }).pick.key, 'b');
  const domAndOpen = [p('a', 4, 5, 80, 5), p('f', 4, 3, 60, 9), p('h', 4, 1, 75, 4)];
  assert.equal(v.coverageCandidate({}, domAndOpen, { credits: 1 }).pick.key, 'h');
  assert.equal(v.coverageCandidate({}, [p('d', 2, 0, 50, 1)], { credits: 1 }), null);
  assert.equal(v.duelAllowed({ timeBudgetMin: 10, windowPct: 32 }), true);
  assert.equal(v.duelAllowed({ timeBudgetMin: 30, windowPct: 32 }), false);
  assert.equal(v.duelAllowed({ timeBudgetMin: 10, windowPct: 60 }), false);
  assert.equal(v.duelAllowed({ timeBudgetMin: 10, windowPct: 10, subOrchestrator: true }), false);
});

// §2.5 calibration: the findings of review-w6/w8/w10/w11/w15 on this job.
test('calibration table reproduces the spec within one point', () => {
  const rv = Object.fromEntries(['w5', 'w6', 'w7', 'w8', 'w10', 'w11', 'w13', 'w15'].map((a) => [a, reviewer(a)]));
  const impl = Object.fromEntries(['w1', 'w2', 'w3', 'w4', 'w14'].map((a) => [a, pick(a)]));
  const w9 = pick('w9', 'docs');
  const w12 = pick('w12', 'tests');
  const records = [];
  const add = (judge, target, severities, { admitted = Infinity, ...extra } = {}) => {
    const out = severities.map((s, i) => {
      const f = finding(judge, target, s, extra);
      records.push(f);
      if (i < admitted) records.push(admit(f));
      return f;
    });
    return out;
  };
  add(rv.w8, impl.w1, ['blocking', 'to-fix', 'to-fix', 'to-fix', 'to-fix', 'to-fix', 'to-fix'], { admitted: 5 });
  add(rv.w10, impl.w1, ['to-fix', 'to-fix', 'to-fix'], { missed: rv.w8.obs });
  add(rv.w5, impl.w2, ['to-fix', 'to-fix', 'to-fix']);
  add(rv.w10, impl.w2, ['to-fix']);
  const w6 = add(rv.w6, impl.w3, ['to-fix', 'to-fix', 'to-fix', 'to-fix'], { admitted: 3 });
  add(rv.w10, impl.w3, ['to-fix'], { missed: rv.w6.obs });
  add(rv.w10, impl.w3, ['to-fix'], { dup: w6[3].id });
  add(rv.w7, impl.w4, ['to-fix', 'to-fix', 'to-fix', 'to-fix', 'to-fix']);
  add(rv.w10, impl.w4, ['to-fix'], { missed: rv.w7.obs });
  add(rv.w11, w9, ['to-fix', 'to-fix', 'to-fix', 'to-fix', 'to-fix', 'to-fix']);
  add(rv.w13, w9, ['to-fix', 'to-fix']);
  add(rv.w15, impl.w14, ['to-fix', 'to-fix']);
  records.push({ type: 'outcome', id: 'obs-w12:outcome', ...w12, outcome: 'as-is' });

  const obs = Object.fromEntries(v.observationScores(records).map((o) => [o.agent, o]));
  const near = (agent, expected) => assert.ok(Math.abs(obs[agent].score - expected) <= 1, `${agent}: ${obs[agent].score} vs ${expected}`);
  near('w1', 46);
  near('w2', 85);
  near('w3', 82);
  near('w4', 78);
  near('w9', 72);
  near('w14', 92);
  near('w12', 80);
  near('w8', 83);
  near('w6', 80);
  near('w7', 86);
  near('w10', 100);
  near('w5', 100);
  near('w11', 100);
  near('w15', 100);
  assert.deepEqual([obs.w10.C, obs.w10.F, obs.w10.M, obs.w8.C, obs.w8.M, obs.w6.C, obs.w6.M, obs.w7.C, obs.w7.M], [7, 0, 0, 14, 3, 3, 1, 5, 1]);
  assert.equal(obs.w12.level, 'outcome');
  assert.equal(obs.w1.level, 'audited');

  const s = v.pickScores(records, [], () => 4)[v.keyOf(impl.w1)];
  assert.equal(s.S, 76);
  assert.equal(s.V, 5);
});

test('a duplicate counts when its original does not, and is counted once in M but still credited to its own reviewer in C', () => {
  const j = reviewer('j');
  const j2 = reviewer('j2');
  const t = pick('t');
  const sugg = finding(j, t, 'suggestion');
  const dupBlocking = finding(j2, t, 'blocking', { dup: sugg.id });
  assert.deepEqual(v.countedFindings([sugg, dupBlocking]).map((f) => f.id), [dupBlocking.id]);
  const orig = finding(j, t, 'to-fix');
  const dup = finding(j2, t, 'to-fix', { dup: orig.id, missed: j.obs });
  const obs = v.observationScores([orig, dup, admit(orig), admit(dup)]);
  const rj2 = obs.find((o) => o.obs === j2.obs);
  assert.equal(rj2.C, 1);
  assert.equal(obs.find((o) => o.obs === j.obs).M, 0);
  assert.equal(obs.find((o) => o.obs === t.obs).counted, 1);
});

test('parseEnvelope rejects malformed options and numbers', () => {
  const r = v.parseEnvelope(envelope('on w1\nF1 to-fix dup=w8: x\nF99999999999999999999 to-fix: x\nF2 to-fix missed=w8 missed=w5: x\nF3 to-fix foo=1: x\nrank w1 0/99999999'));
  assert.equal(r.errors.length, 5);
  assert.deepEqual(r.lines, []);
});

test('parseEnvelope handles several envelopes, indented and long fences, stray closing tags', () => {
  const first = '<verdict-report v="1">\non w1\nclean\n</verdict-report>';
  assert.deepEqual(v.parseEnvelope(`${first}\ntext\n${envelope('on w2\nclean')}`).lines.map((l) => l.target), ['w2']);
  assert.equal(v.parseEnvelope(`${first}\n</verdict-report>`), null);
  assert.equal(v.parseEnvelope(`  \`\`\`\n${first}\n  \`\`\`\n</verdict-report>`), null);
  assert.equal(v.parseEnvelope(`\`\`\`\`\n\`\`\`\n${first}\n\`\`\`\n\`\`\`\`\n</verdict-report>`), null);
});

test('acceptLines: a duplicated id in one batch is stored once, missed on oneself is refused, two-level ancestors', () => {
  const ctx = ctxOf(rv, [{ role: 'reviewer', targets: ['w1'] }]);
  const r = v.acceptLines(parse('on w1\nF1 to-fix: x\nF1 blocking: y'), ctx);
  assert.equal(r.accepted.length, 1);
  assert.equal(r.ignored, 1);
  const own = v.acceptLines(parse('on w1\nF2 to-fix missed=w8: x'), ctx);
  assert.equal(own.rejected.length, 1);
  const chain = ctxOf(w1, [{ role: 'reviewer', targets: ['w2'] }], { parentOf: { w1: 'x', x: 'y', y: 'w2' } });
  assert.match(v.acceptLines(parse('on w2\nclean'), chain).rejected[0].reason, /parent/);
});

test('acceptLines: a rank needs a judge mission even without ancestors', () => {
  const r = v.acceptLines(parse('on w1\nclean\nrank w1 1/2'), ctxOf(rv, [{ role: 'consumer', targets: ['w1'] }]));
  assert.deepEqual(r.accepted.map((x) => x.type), ['clean']);
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /mission/);
});

test('a rank alone audits the target', () => {
  const t = pick('t');
  const rank = { type: 'rank', id: 'j:rank:t', judge: J(reviewer('j'), 'judge'), target: t, rank: 1, of: 2 };
  assert.deepEqual([score([rank], t.obs).level, score([rank], t.obs).score], ['audited', 100]);
});

test('reviewer evaluation depends on a verifier coming after, not before', () => {
  const t = pick('t');
  const j = reviewer('j');
  const other = reviewer('o');
  const f = finding(j, t, 'to-fix');
  const rev = (...recs) => v.observationScores(recs).find((o) => o.obs === j.obs);
  assert.equal(rev(f, clean(other, t)).level, 'evaluated');
  assert.equal(rev(clean(other, t), f), undefined);
});

test('V is rounded before the confidence level', () => {
  const j = reviewer('j');
  const records = Array.from({ length: 10 }, (_, i) => clean(j, pick(`t${i}`)));
  const s = Object.values(v.pickScores(records, [], () => 4))[0];
  assert.equal(s.V, 3);
  assert.equal(s.confidence, 'moyenne');
});

test('the outcome record is read in its flat and nested forms', () => {
  const t = pick('t');
  const flat = v.observationScores([{ type: 'outcome', id: 'a', ...t, outcome: 'redone' }]);
  const nested = v.observationScores([{ type: 'outcome', id: 'a', pick: t, outcome: 'redone' }]);
  assert.deepEqual(flat.map((o) => o.score), [15]);
  assert.deepEqual(nested.map((o) => o.score), [15]);
  assert.deepEqual(v.observationScores([{ type: 'outcome', id: 'a', ...t, outcome: null }]), []);
});

test('retain follows dup chains and dropped judges', () => {
  const a = pick('a');
  const j = pick('j', 'review');
  const b = pick('b');
  const c = pick('c');
  const fj = finding(pick('z', 'review'), j, 'to-fix');
  const fa = finding(j, a, 'to-fix');
  const fb = finding(reviewer('k'), b, 'to-fix', { dup: fa.id });
  const fc = finding(reviewer('k'), c, 'to-fix', { dup: fb.id });
  const records = [fj, fa, fb, fc, clean(reviewer('k'), pick('d'))];
  const kept = v.retain(records, 3).map((r) => r.id);
  assert.deepEqual(kept, [fc.id, clean(reviewer('k'), pick('d')).id].filter((id) => kept.includes(id)));
  assert.ok(!kept.includes(fa.id) && !kept.includes(fb.id) && !kept.includes(fj.id));
});

test('on value a much weaker pick only leads when it is really cheaper, and never below good enough', () => {
  const p = (key, S, quotaCost) => ({ key, S, quotaCost, durationMs: 1 });
  const order = (picks) => v.orderPicks(picks, undefined).map((x) => x.key);
  assert.deepEqual(order([p('strong', 87, 10), p('cheap', 73, 9)]), ['strong', 'cheap']);
  assert.deepEqual(order([p('strong', 87, 10), p('cheap', 73, 7.5)]), ['cheap', 'strong']);
  assert.deepEqual(order([p('strong', 85, 10), p('cheap', 75, 9.9)]), ['cheap', 'strong']);
  assert.deepEqual(order([p('strong', 74, 9), p('cheap', 66, 1)]), ['strong', 'cheap']);
  assert.deepEqual(order([p('a', 60, 9), p('b', 55, 1)]), ['a', 'b']);
  assert.deepEqual(order([p('strong', 90, 10), p('mid', 78, 9), p('cheap', 71, 2)]), ['cheap', 'strong', 'mid']);
  assert.deepEqual([v.VALUE_BAND, v.VALUE_SAVING], [10, 0.75]);
  assert.deepEqual(order([p('strong', 87, 10), p('edge', 77, 9.9), p('far', 76, 7.5), p('out', 76, 7.6)]), ['far', 'edge', 'strong', 'out']);
});

test('the value band is anchored on the cheapest of the best-scored picks, whatever the keys and the input order', () => {
  const p = (key, S, quotaCost) => ({ key, S, quotaCost, durationMs: 1 });
  const order = (picks) => v.orderPicks(picks, undefined).map((x) => x.key);
  const picks = [p('a-dear', 87, 10), p('b-cheap', 87, 4), p('c', 75, 6)];
  assert.deepEqual(order(picks), ['b-cheap', 'a-dear', 'c']);
  assert.deepEqual(order([...picks].reverse()), ['b-cheap', 'a-dear', 'c']);
  assert.deepEqual(order([p('z-dear', 87, 10), p('y-cheap', 87, 4), p('c', 75, 6)]), ['y-cheap', 'z-dear', 'c']);
});

test('without a cost on the best-scored pick, a much weaker pick never leads', () => {
  const picks = [{ key: 'strong', S: 90, durationMs: 1 }, { key: 'weak', S: 71, quotaCost: 1, durationMs: 1 }, { key: 'none', S: 72, durationMs: 1 }];
  assert.deepEqual(v.orderPicks(picks, undefined).map((x) => x.key), ['strong', 'none', 'weak']);
});

test('orderPicks tolerates a missing score', () => {
  const picks = [{ key: 'a', S: NaN, quotaCost: 1 }, { key: 'b', S: 80, quotaCost: 2 }, { key: 'c', quotaCost: 1 }];
  const once = v.orderPicks(picks, 'quality').map((p) => p.key);
  assert.deepEqual(once, ['b', 'a', 'c']);
  assert.deepEqual(v.orderPicks([...picks].reverse(), 'quality').map((p) => p.key), once);
});

test('missed needs the reviewer in the writer mission', () => {
  const base = v.acceptLines(parse('on w1\nF1 to-fix: x'), ctxOf(rv, [{ role: 'reviewer', targets: ['w1'] }])).accepted;
  const w10 = reviewer('w10');
  const without = v.acceptLines(parse('on w1\nF1 to-fix missed=w8: x'), ctxOf(w10, [{ role: 'reviewer', targets: ['w1'] }], { records: base }));
  assert.equal(without.accepted.length, 0);
  const withIt = v.acceptLines(parse('on w1\nF1 to-fix missed=w8: x'), ctxOf(w10, [{ role: 'reviewer', targets: ['w1', 'w8'] }], { records: base }));
  assert.equal(withIt.accepted[0].missed, 'obs-w8');
});

test('duplicates of an original that no longer counts weigh one defect once', () => {
  const t = pick('t');
  const orig = finding(reviewer('a'), t, 'blocking');
  const d1 = finding(reviewer('b'), t, 'blocking', { dup: orig.id });
  const d2 = finding(reviewer('c'), t, 'to-fix', { dup: orig.id });
  const f = triage(orig, reviewer('x'), 'false', 'challenger');
  assert.deepEqual(v.countedFindings([orig, d1, d2, f]).map((x) => x.id), [d1.id]);
  assert.equal(score([orig, d1, d2, f], t.obs).score, 66);
  const sugg = finding(reviewer('a'), t, 'suggestion');
  const e1 = finding(reviewer('b'), t, 'to-fix', { dup: sugg.id });
  const e2 = finding(reviewer('c'), t, 'to-fix', { dup: sugg.id });
  assert.deepEqual(v.countedFindings([sugg, e1, e2]).map((x) => x.id), [e1.id]);
});

test('redactText hides home prefixes and UUIDs', () => {
  assert.equal(v.redactText('see /home/alice/app/a.js:3 and /Users/bob/x and /root/.claude/y'), 'see ~/app/a.js:3 and ~/x and ~/.claude/y');
  assert.equal(v.redactText('master 7f48db89-a2b2-4d38-a52f-642ef5b6e132 did'), 'master … did');
  assert.equal(v.redactText('server/core/a.js:3'), 'server/core/a.js:3');
  assert.equal(v.redactText(undefined), '');
  const r = v.acceptLines(parse('on w1\nF1 to-fix: crash in /home/alice/x.js for 7f48db89-a2b2-4d38-a52f-642ef5b6e132'), ctxOf(rv, [{ role: 'reviewer', targets: ['w1'] }]));
  assert.equal(r.accepted[0].text, 'crash in ~/x.js for …');
});
