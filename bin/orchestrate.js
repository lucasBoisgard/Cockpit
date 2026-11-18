#!/usr/bin/env node
// Command line used by a master session (and its agents) to drive its team through the cockpit API.
// It identifies the calling session with CLAUDE_CODE_SESSION_ID, set by Claude Code in every Bash call.
const fs = require('node:fs');
const path = require('node:path');
const core = require('../server/core/orchestration');
const { parseFlags } = require('../server/core/cli-flags');
const { RATE_REPLACED } = require('../server/core/verdict-capture');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.COCKPIT_PORT || '8052';
const CALLER = process.env.COCKPIT_CALLER || process.env.CLAUDE_CODE_SESSION_ID || '';

const USAGE = `orchestrate <commande>

  status                         état de l'équipe (phases, agents, derniers événements)
  new "<objectif>"               clôt le job livré et repart d'un board vierge (refusé si un agent travaille encore)
  plan <phase> <phase>…          définit les phases, dans l'ordre (numérotées à partir de 1)
  skills                         skills disponibles pour les agents
  models                         fournisseurs (Claude, GPT via Codex), leurs modèles et leurs niveaux d'effort
  balance                        équilibre Claude/GPT : remplissage des limites de chaque fournisseur (7 j, 5 h) et celui à privilégier pour le prochain agent
  matrix [catégorie]             matrice de pertinence : quel fournisseur, modèle et effort pour quel type de tâche,
                                 avec les verdicts des agents vérificateurs
  rate                           remplacé par outcome : la qualité vient des verdicts des vérificateurs
  outcome <id> as-is|fixed|partial|redone ["note"]
                                 enregistre comment le travail d'un agent a été intégré (tel quel, après corrections, en partie, refait)
  verdicts [id]                  constats, triages et contestations du job : qui a jugé qui, rôle, modèle·effort
  verdicts --capture <id>        relit le dernier message de l'agent et enregistre ses verdicts (si le transcript est arrivé en retard)
  verifies <id> <rôle>:<ids>     ajoute des cibles à la mission d'un agent en vie (relecture delta, duel)
  calibration [on|off]           mode Arène de cette orchestration : chaque tâche est confiée à plusieurs modèles en parallèle,
                                 un juge les note, jusqu'à ce que chaque combinaison pertinente ait assez de notes ; sans argument, affiche l'état
  rescore <catégorie> <fournisseur>:<modèle>:<effort> <1-5> "<raison>"
                                 propose une nouvelle note de référence pour un choix (ou son ajout), à valider par l'utilisateur dans la page Matrice, ex. :
                                 rescore debug claude:opus:medium 4 "a trouvé la cause seul en 6 min"
  launch --name <nom> [--kind <catégorie>] [--phase <nom|numéro>] [--provider claude|codex] [--model <modèle>] [--effort low|medium|high|xhigh|max]
         [--skill <nom>]… [--mode acceptEdits|auto|plan|default] [--isolated] [--brief <texte> | --brief-file <fichier>]
         [--verifies <rôle>:<id>[,<id>…]]… [--explore] [--minutes <durée prévue>]
                                 --verifies : mission de vérification (reviewer, challenger, judge, consumer) ; ses constats ne sont acceptés que sur ces agents
                                 --explore : lance le candidat de la file de couverture de la catégorie (--kind obligatoire) ; en catégorie qualité, c'est un duel à côté du premier choix :
                                   tâche courte (--minutes ≤ 15), fenêtre 7 j du fournisseur sous 50 %, pas de sous-orchestrateur, puis un juge --verifies judge:<a>,<b>
                                 lance un agent ; sans --brief, le brief est lu sur l'entrée standard
  read <id>                      rapport complet du dernier tour d'un agent, et ses fichiers modifiés
  send <id> <message>            écrit à un agent (mis en file s'il travaille) ; chaque message après sa première livraison compte comme un aller-retour
  send <id> --info "<message>"   (ou --info en fin de ligne) message qui n'est pas une correction (périmètre ajouté, précision, renvoi) : pas compté comme aller-retour
  stop <id>                      arrête un agent
  resume <id> [message]          relance un agent arrêté, ou lui écrit s'il tourne encore`;

function token() {
  try {
    return fs.readFileSync(path.join(ROOT, 'token'), 'utf8').trim();
  } catch {
    fail('Token du cockpit introuvable : le cockpit est-il installé ?');
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const mtok = (n) => (Math.round(n / 1e3) < 1000 ? `${Math.round(n / 1e3)} k tok` : `${(Math.round(n / 1e5) / 10).toLocaleString('fr-FR')} M tok`);
const minutes = (ms) => (ms < 60000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60000)} min`);
// The best available pick of each provider, so that the overview never shows one family only.
const OUTCOME_LABEL = { 'as-is': 'tels quels', fixed: 'après corrections', partial: 'partiels', redone: 'refaits' };
const ROLE_LABEL = { reviewer: 'relecteur', challenger: 'challenger', judge: 'juge Arène', consumer: 'consommateur', author: 'auteur' };
const bestPerProvider = (picks) => ['claude', 'codex'].map((id) => picks.find((p) => p.available && p.provider === id)).filter(Boolean);

async function call(route, body, { soft = false } = {}) {
  const url = `http://127.0.0.1:${PORT}${route}`;
  const headers = { 'X-Cockpit-Token': token() };
  let res;
  try {
    res = body
      ? await fetch(url, { method: 'POST', headers: { ...headers, 'X-Cockpit': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ caller: CALLER, ...body }) })
      : await fetch(url, { headers });
  } catch {
    if (soft) return null;
    fail(`Le cockpit ne répond pas sur le port ${PORT}. Lance ~/.claude/cockpit/ensure.sh puis réessaie.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    if (soft) return null;
    fail(data.error || `Erreur ${res.status}`);
  }
  return data;
}

function readStdin() {
  if (process.stdin.isTTY) return '';
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const STATUS = { starting: 'démarre', working: 'travaille', needs: 'ATTEND L\'UTILISATEUR', done: 'a fini', stopped: 'arrêté' };

const comboLabel = (p) => `${p.provider === 'codex' ? 'GPT ' : ''}${p.model}·${p.effort || '-'}`;

function calibrationLine(c) {
  const ratio = `${c.done}/${c.total} combinaisons calibrées`;
  return c.complete ? `Mode Arène actif : ${ratio} — complète : orchestrate calibration off` : `Mode Arène actif : ${ratio} — voir orchestrate calibration`;
}

function printCalibration(c) {
  const lines = [`Arène : ${c.on ? 'active' : 'inactive'}`, `${c.done}/${c.total} combinaisons calibrées (cible : ${c.target} notes)`];
  const byCategory = {};
  for (const m of c.missing) (byCategory[m.category] ||= []).push(m);
  for (const [category, list] of Object.entries(byCategory)) {
    lines.push('', `${category} :`, ...list.map((m) => `  ${comboLabel(m)} (${m.n} note${m.n > 1 ? 's' : ''})`));
  }
  if (c.on && c.complete) lines.push('', 'La calibration est complète : désactive-la avec orchestrate calibration off.');
  console.log(lines.join('\n'));
}

const warn = (r) => r?.warning && console.log(r.warning);

function printStatus(v, calibration) {
  const phase = core.phaseSummary(v);
  const phaseName = (i) => (v.phases[i] ? `« ${v.phases[i]} »` : `${i + 1}`);
  const lines = [`Maître ${v.worktree} · ${phase} · ${v.counts.working + v.counts.starting} actifs / ${v.settings.maxAgents} max · autonomie ${v.settings.autonomy}${v.paused ? ' · EN PAUSE' : ''}`];
  if (v.settings.arena && calibration) lines.push(calibrationLine(calibration));
  if (v.phases.length) lines.push(`Plan : ${v.phases.map((p, i) => `${i + 1}. ${p}`).join('  ')}`);
  if (!v.agents.length) lines.push('Aucun agent.');
  for (const a of v.agents) {
    const setting = [a.provider === 'codex' ? 'GPT' : null, a.model || 'défaut', a.effort, ...a.skills].filter(Boolean).join(' · ');
    lines.push(`${a.id.padEnd(4)} ${STATUS[a.status].padEnd(13)} ${a.name}  [${setting}]${a.kind ? ` ${a.kind}` : ''}${a.outcome ? ` ${a.outcome}` : ''}${a.unverifiedExploration ? ' · exploration non vérifiée' : ''} phase ${phaseName(a.phase)}${a.parentId ? ` · lancé par ${a.parentId}` : ''}${a.isolated ? ` · branche ${a.branch}` : ''}${a.overBudget ? ` · ⚠ ${a.budgetLabel}` : ''}`);
    if (a.status === 'needs' && a.message) lines.push(`     ↳ ${a.message}`);
    else if (a.status === 'working' && a.action) lines.push(`     ↳ ${a.action}`);
  }
  const recent = v.events.slice(-8);
  if (recent.length) lines.push('', 'Derniers événements :', ...recent.map((e) => `  ${new Date(e.at).toTimeString().slice(0, 5)} ${e.text}`));
  console.log(lines.join('\n'));
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') return console.log(USAGE);
  if (!CALLER) fail('CLAUDE_CODE_SESSION_ID absent : cette commande se lance depuis une session Claude du cockpit.');
  const { flags, rest, errors } = parseFlags(args);
  if (errors.length) fail(errors.join('\n'));
  const q = (extra = '') => `?caller=${encodeURIComponent(CALLER)}${extra}`;
  switch (command) {
    case 'status':
      const status = await call(`/api/orch${q()}`);
      return printStatus(status, status.settings.arena ? await call('/api/calibration') : null);
    case 'new': {
      const r = await call('/api/orch/new', { goal: rest.join(' ') });
      return console.log(`Job ${r.job} ouvert : le board est vierge, les agents repartent de w1. L'ancien job reste dans l'historique.`);
    }
    case 'plan': {
      const r = await call('/api/orch/plan', { phases: rest });
      return console.log(`Plan enregistré : ${r.phases.map((p, i) => `${i + 1}. ${p}`).join('  ')}`);
    }
    case 'models': {
      const p = await call('/api/providers');
      return console.log(Object.entries(p).map(([id, v]) => `${id} — ${v.label}${v.available ? '' : v.installed === false ? ' (non installé)' : ' (non connecté : indisponible)'}\n  modèles : ${v.models.map((m) => m.id).join(', ')}\n  efforts : ${v.efforts.join(', ')}`).join('\n'));
    }
    case 'balance': {
      const b = await call('/api/balance');
      return console.log(b.text);
    }
    case 'matrix': {
      const m = await call('/api/matrix');
      const balance = await call('/api/balance', undefined, { soft: true });
      const label = (p) => `${p.provider === 'codex' ? 'GPT ' : ''}${p.model}·${p.effort || '-'}`;
      const stars = (p) => (p.offMatrix || p.score == null ? 'hors matrice' : `réf. ${'★'.repeat(p.score)}`);
      const pick = (p, i) => {
        const ev = p.evidence || {};
        const unverified = Math.max(0, (ev.observationCount || 0) - (ev.verified || 0) - (ev.legacyCount || 0));
        const legacy = ev.legacyCount ? ` · ${ev.legacyCount} ancienne${ev.legacyCount > 1 ? 's' : ''} note${ev.legacyCount > 1 ? 's' : ''} ${ev.legacyAvg.toFixed(1).replace('.', ',')}/5` : '';
        const cost = p.measured?.tokens != null ? mtok(p.measured.tokens) : 'coût non mesuré';
        const time = p.measured?.durationMs != null ? minutes(p.measured.durationMs) : 'durée non mesurée';
        const n = p.measured ? ` (${p.measured.n} mesuré${p.measured.n > 1 ? 's' : ''})` : '';
        const head = `  ${i + 1}. ${label(p).padEnd(26)} ${stars(p)} · ${p.quality}/100 · ${ev.verified ? `confiance ${p.confidence} (${ev.verified} vérifié${ev.verified > 1 ? 's' : ''})` : p.confidence} · ${cost} · ${time}${n}${p.available ? '' : ' · indisponible'}${p.goodEnough ? '' : ' · sous le seuil de 70'}`;
        const evidence = ev.verified || unverified || ev.legacyCount ? `     preuves : ${ev.verified || 0} vérifié${ev.verified > 1 ? 's' : ''} · ${unverified} sans vérificateur${legacy}` : '     preuves : aucun verdict';
        const outcomes = Object.entries(ev.outcomes || {}).filter(([k]) => OUTCOME_LABEL[k]).map(([k, c]) => `${c} ${OUTCOME_LABEL[k]}`).join(', ');
        const ranks = [...(ev.ranks || []).reduce((acc, r) => acc.set(`${r.rank}/${r.of}`, (acc.get(`${r.rank}/${r.of}`) || 0) + 1), new Map())].map(([k, c]) => `Arène ${k.replace(/^1\//, '1er/')}${c > 1 ? ` ×${c}` : ''}`);
        const apart = [outcomes && `intégrés : ${outcomes}`, ev.medianRounds != null && `allers-retours médian ${ev.medianRounds}`, ...ranks].filter(Boolean);
        const lines = (ev.observations || []).filter((o) => o.level !== 'outcome' && o.level !== 'legacy').slice(-3).reverse().map((o) => `     ${o.agent || '?'} : ${o.score}/100 — ${o.kind === 'reviewer' ? `relecteur (${o.C} confirmé${o.C > 1 ? 's' : ''}, ${o.F} faux, ${o.M} manqué${o.M > 1 ? 's' : ''})` : `${o.judges.map((j) => `${j.agent || '?'} ${ROLE_LABEL[j.role] || j.role} ${label(j)}`).join(' ; ') || 'sans juge'} : ${o.counted} constat${o.counted > 1 ? 's' : ''} retenu${o.counted > 1 ? 's' : ''}${o.contested ? `, ${o.contested} contesté${o.contested > 1 ? 's' : ''}` : ''}`}`);
        return [head, evidence, apart.length ? `     hors score : ${apart.join(' · ')}` : '', ...lines, p.why ? `     ${p.why}` : ''].filter(Boolean).join('\n');
      };
      const queue = (c) => {
        if (!c.coverageCandidate) return '';
        const cand = c.picks.find((p) => p.key === c.coverageCandidate.key);
        if (!cand) return '';
        const credits = m.coverage?.credits || 0;
        const week = balance?.[cand.provider === 'codex' ? 'codex' : 'claude']?.weekPercent;
        const first = c.picks.find((p) => p.available)?.key === cand.key;
        const how = first ? 'il manque de vérifications : lui donner un vérificateur' : c.coverageCandidate.mode === 'duel' ? `duel à côté du premier choix, tâche courte${Number.isFinite(week) ? `, fenêtre 7 j ${cand.provider === 'codex' ? 'GPT' : 'Claude'} à ${Math.round(week)} %` : ''}` : 'remplace le premier choix sur une tâche réversible et vérifiée (--explore)';
        return `\nFile de couverture : ${credits} crédit${credits > 1 ? 's' : ''} — candidat ${label(cand)} (${cand.confidence}) : ${how}`;
      };
      if (rest[0]) {
        const c = m.categories.find((x) => x.id === rest[0]);
        if (!c) fail(`Catégorie inconnue : ${rest[0]} (${m.categories.map((x) => x.id).join(', ')}).`);
        return console.log(`${c.label} [${c.id}]${c.source === 'local' ? ' · réglage local' : ''}\n${c.description || ''}\n${c.picks.map(pick).join('\n')}${queue(c)}`);
      }
      const head = `Matrice de pertinence (${m.available.codex ? 'Claude et GPT disponibles' : 'GPT indisponible : Codex non connecté'})\n${m.note}`;
      const rows = m.categories.map((c) => `${c.id.padEnd(14)} ${c.label} → ${bestPerProvider(c.picks).map((p) => `${label(p)} ${p.quality} (${p.confidence})`).join(', ') || '—'}`).join('\n');
      return console.log(`${head}${balance?.text ? `\n${balance.text}` : ''}\n\n${rows}\n\nDétail : orchestrate matrix <catégorie>`);
    }
    case 'rate':
      return fail(RATE_REPLACED);
    case 'outcome': {
      const r = await call('/api/orch/outcome', { id: rest[0], outcome: rest[1], note: rest.slice(2).join(' ') });
      return console.log(`${rest[0]} : ${r.outcome} enregistré (${r.rounds} aller-retour${r.rounds > 1 ? 's' : ''}, ${r.deliveries} livraison${r.deliveries > 1 ? 's' : ''}).`);
    }
    case 'verifies': {
      const [id, ...specs] = rest;
      const r = await call('/api/orch/verifies', { id, verifies: specs });
      return console.log(`${id} vérifie maintenant : ${r.mission}.`);
    }
    case 'verdicts': {
      if (flags.capture) {
        const r = await call('/api/orch/verdicts/capture', { id: flags.capture });
        if (r.reason === 'pending') return console.log(`Le message final du tour de ${flags.capture} n'est pas encore dans son transcript : réessaie dans quelques secondes.`);
        if (r.reason === 'known') return console.log(`Le dernier message de ${flags.capture} est déjà enregistré.`);
        return console.log(r.lines.length ? r.lines.join('\n') : `Aucun verdict à enregistrer dans le dernier message de ${flags.capture}.`);
      }
      const r = await call(`/api/orch/verdicts${q(`&id=${encodeURIComponent(rest[0] || '')}`)}`);
      return console.log(r.lines.length ? r.lines.join('\n') : 'Aucun verdict enregistré dans ce job.');
    }
    case 'calibration': {
      if (rest[0] && rest[0] !== 'on' && rest[0] !== 'off') fail('Usage : orchestrate calibration [on|off]');
      if (rest[0]) {
        const c = await call('/api/orch/arena', { on: rest[0] === 'on' });
        return console.log(`Arène : ${c.on ? 'active' : 'inactive'}`);
      }
      return printCalibration(await call(`/api/orch/arena${q()}`));
    }
    case 'rescore': {
      const [category, combo, score, ...reason] = rest;
      const parts = String(combo || '').split(':');
      const [provider, effort] = [parts[0], parts.length > 2 ? parts[parts.length - 1] : undefined];
      const model = parts.slice(1, parts.length > 2 ? -1 : undefined).join(':');
      if (!category || !provider || !model || !score) fail('Usage : orchestrate rescore <catégorie> <fournisseur>:<modèle>:<effort> <1-5> "<raison>"');
      await call('/api/orch/rescore', { category, provider, model, effort: effort || null, score: Number(score), why: reason.join(' ') });
      return console.log(`Proposition enregistrée : ${provider === 'codex' ? 'GPT ' : ''}${model}·${effort || '-'} à ${score}/5 en ${category}. En attente de validation de l’utilisateur dans la page Matrice ; la recommandation ne change pas d’ici là.`);
    }
    case 'skills': {
      const list = await call('/api/orch/skills');
      return console.log(list.map((s) => `${s.name} — ${s.description}`).join('\n'));
    }
    case 'launch': {
      const brief = flags.brief || (flags.briefFile ? fs.readFileSync(flags.briefFile, 'utf8') : readStdin());
      const phase = flags.phase && /^\d+$/.test(flags.phase) ? Number(flags.phase) - 1 : flags.phase;
      const r = await call('/api/orch/launch', { name: flags.name, kind: flags.kind, phase, provider: flags.provider, model: flags.model, effort: flags.effort, mode: flags.mode, skills: flags.skills, isolated: !!flags.isolated, verifies: flags.verifies, explore: !!flags.explore, minutes: flags.minutes ? Number(flags.minutes) : undefined, brief });
      return console.log(`${r.id} lancé${r.branch ? ` dans son worktree ${r.cwd} (branche ${r.branch})` : ''}. Le cockpit t'écrira quand il aura fini son tour.`);
    }
    case 'read': {
      const r = await call(`/api/orch/read${q(`&id=${encodeURIComponent(rest[0] || '')}`)}`);
      const files = r.files.length ? `\nFichiers modifiés : ${r.files.join(', ')}` : '';
      return console.log(`${r.id} « ${r.name} » · ${STATUS[r.status]}${r.branch ? ` · branche ${r.branch}` : ''}${files}\n\n${r.report || '(aucun rapport pour l\'instant)'}`);
    }
    case 'send': {
      const r = await call('/api/orch/send', { id: rest[0], text: (typeof flags.info === 'string' ? flags.info : rest.slice(1).join(' ')) || readStdin(), info: !!flags.info });
      console.log(r.delivery === 'queued' ? `Message mis en file : ${rest[0]} le lira à la fin de son tour.` : 'Message envoyé.');
      return warn(r);
    }
    case 'stop':
      await call('/api/orch/stop', { id: rest[0] });
      return console.log(`${rest[0]} arrêté.`);
    case 'resume': {
      const resumed = await call('/api/orch/resume', { id: rest[0], text: rest.slice(1).join(' ') });
      console.log(`${rest[0]} relancé.`);
      return warn(resumed);
    }
    default:
      fail(`Commande inconnue : ${command}\n\n${USAGE}`);
  }
}

main();
