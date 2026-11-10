#!/usr/bin/env node
// Command line used by a master session (and its agents) to drive its team through the cockpit API.
// It identifies the calling session with CLAUDE_CODE_SESSION_ID, set by Claude Code in every Bash call.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PORT = process.env.COCKPIT_PORT || '8052';
const CALLER = process.env.COCKPIT_CALLER || process.env.CLAUDE_CODE_SESSION_ID || '';

const USAGE = `orchestrate <commande>

  status                         état de l'équipe (phases, agents, derniers événements)
  new "<objectif>"               clôt le job livré et repart d'un board vierge (refusé si un agent travaille encore)
  plan <phase> <phase>…          définit les phases, dans l'ordre (numérotées à partir de 1)
  skills                         skills disponibles pour les agents
  models                         fournisseurs (Claude, GPT via Codex), leurs modèles et leurs niveaux d'effort
  matrix [catégorie]             matrice de pertinence : quel fournisseur, modèle et effort pour quel type de tâche,
                                 avec les notes observées sur les agents précédents
  rate <id> <1-5> [note] [--kind <catégorie>]
                                 note le travail d'un agent une fois vérifié (alimente la matrice)
  calibration [on|off]           mode calibration : les maîtres mettent les modèles en concurrence et un juge les note,
                                 jusqu'à ce que chaque combinaison pertinente ait assez de notes ; sans argument, affiche l'état
  rescore <catégorie> <fournisseur>:<modèle>:<effort> <1-5> "<raison>"
                                 corrige la note de référence d'un choix (l'ajoute à la catégorie s'il y manque), ex. :
                                 rescore debug claude:fable:medium 4 "a trouvé la cause seul en 6 min"
  launch --name <nom> [--kind <catégorie>] [--phase <nom|numéro>] [--provider claude|codex] [--model <modèle>] [--effort low|medium|high|xhigh|max]
         [--skill <nom>]… [--mode acceptEdits|auto|plan|default] [--isolated] [--brief <texte> | --brief-file <fichier>]
                                 lance un agent ; sans --brief, le brief est lu sur l'entrée standard
  read <id>                      rapport complet du dernier tour d'un agent, et ses fichiers modifiés
  send <id> <message>            écrit à un agent (mis en file s'il travaille)
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

async function call(route, body) {
  const url = `http://127.0.0.1:${PORT}${route}`;
  const headers = { 'X-Cockpit-Token': token() };
  let res;
  try {
    res = body
      ? await fetch(url, { method: 'POST', headers: { ...headers, 'X-Cockpit': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ caller: CALLER, ...body }) })
      : await fetch(url, { headers });
  } catch {
    fail(`Le cockpit ne répond pas sur le port ${PORT}. Lance ~/.claude/cockpit/ensure.sh puis réessaie.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) fail(data.error || `Erreur ${res.status}`);
  return data;
}

function parseFlags(args) {
  const flags = { skills: [] };
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      rest.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (key === 'isolated') flags.isolated = true;
    else if (key === 'skill') flags.skills.push(args[++i]);
    else flags[key.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = args[++i];
  }
  return { flags, rest };
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
  return c.complete ? `Mode calibration actif : ${ratio} — complète : orchestrate calibration off` : `Mode calibration actif : ${ratio} — voir orchestrate calibration`;
}

function printCalibration(c) {
  const lines = [`Calibration : ${c.on ? 'active' : 'inactive'}`, `${c.done}/${c.total} combinaisons calibrées (cible : ${c.target} notes)`];
  const byCategory = {};
  for (const m of c.missing) (byCategory[m.category] ||= []).push(m);
  for (const [category, list] of Object.entries(byCategory)) {
    lines.push('', `${category} :`, ...list.map((m) => `  ${comboLabel(m)} (${m.n} note${m.n > 1 ? 's' : ''})`));
  }
  if (c.on && c.complete) lines.push('', 'La calibration est complète : désactive-la avec orchestrate calibration off.');
  console.log(lines.join('\n'));
}

function printStatus(v, calibration) {
  const phase = v.phases.length ? `phase ${v.phase + 1}/${v.phases.length} « ${v.phases[v.phase] || '?'} »` : 'pas de plan';
  const phaseName = (i) => (v.phases[i] ? `« ${v.phases[i]} »` : `${i + 1}`);
  const lines = [`Maître ${v.worktree} · ${phase} · ${v.counts.working + v.counts.starting} actifs / ${v.settings.maxAgents} max · autonomie ${v.settings.autonomy}${v.paused ? ' · EN PAUSE' : ''}`];
  if (calibration?.on) lines.push(calibrationLine(calibration));
  if (v.phases.length) lines.push(`Plan : ${v.phases.map((p, i) => `${i + 1}. ${p}`).join('  ')}`);
  if (!v.agents.length) lines.push('Aucun agent.');
  for (const a of v.agents) {
    const setting = [a.provider === 'codex' ? 'GPT' : null, a.model || 'défaut', a.effort, ...a.skills].filter(Boolean).join(' · ');
    lines.push(`${a.id.padEnd(4)} ${STATUS[a.status].padEnd(13)} ${a.name}  [${setting}]${a.kind ? ` ${a.kind}` : ''}${a.rating ? ` noté ${a.rating.score}/5` : ''} phase ${phaseName(a.phase)}${a.parentId ? ` · lancé par ${a.parentId}` : ''}${a.isolated ? ` · branche ${a.branch}` : ''}`);
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
  const { flags, rest } = parseFlags(args);
  const q = (extra = '') => `?caller=${encodeURIComponent(CALLER)}${extra}`;
  switch (command) {
    case 'status':
      return printStatus(await call(`/api/orch${q()}`), await call('/api/calibration'));
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
    case 'matrix': {
      const m = await call('/api/matrix');
      const stars = (n) => (n == null ? 'hors matrice' : `${n}/5`);
      const pick = (p, i) => {
        const obs = `${p.observed ? ` · observé ${p.observed.avg}/5 sur ${p.observed.n}` : ''}${(p.observed?.n || 0) < 3 ? ' · à éprouver' : ''}`;
        const label = `${p.provider === 'codex' ? 'GPT ' : ''}${p.model} · ${p.effort || 'effort par défaut'}`;
        return `  ${i + 1}. ${label.padEnd(30)} ${stars(p.score)}${obs}${p.available ? '' : ' · INDISPONIBLE'}${p.why ? `\n     ${p.why}` : ''}${(p.observed?.notes || []).map((n) => `\n     « ${n.note} » (${n.score}/5, ${n.agent || '?'})`).join('')}`;
      };
      if (rest[0]) {
        const c = m.categories.find((x) => x.id === rest[0]);
        if (!c) fail(`Catégorie inconnue : ${rest[0]} (${m.categories.map((x) => x.id).join(', ')}).`);
        return console.log(`${c.label} [${c.id}]${c.source === 'local' ? ' · réglage local' : ''}\n${c.description || ''}\n${c.picks.map(pick).join('\n')}`);
      }
      const head = `Matrice de pertinence (${m.available.codex ? 'Claude et GPT disponibles' : 'GPT indisponible : Codex non connecté'})\n${m.note}`;
      return console.log(`${head}\n\n${m.categories.map((c) => `${c.id.padEnd(14)} ${c.label} → ${c.picks.filter((p) => p.available).slice(0, 2).map((p) => `${p.provider === 'codex' ? 'GPT ' : ''}${p.model}·${p.effort || '-'} (${p.rank})`).join(', ') || '—'}`).join('\n')}\n\nDétail : orchestrate matrix <catégorie>`);
    }
    case 'rate': {
      await call('/api/orch/rate', { id: rest[0], score: Number(rest[1]), note: rest.slice(2).join(' '), kind: flags.kind });
      return console.log(`${rest[0]} noté ${rest[1]}/5. Merci : la matrice en tient compte.`);
    }
    case 'calibration': {
      if (rest[0] && rest[0] !== 'on' && rest[0] !== 'off') fail('Usage : orchestrate calibration [on|off]');
      if (rest[0]) {
        const c = await call('/api/calibration', { mode: rest[0] });
        return console.log(`Calibration : ${c.on ? 'active' : 'inactive'}`);
      }
      return printCalibration(await call('/api/calibration'));
    }
    case 'rescore': {
      const [category, combo, score, ...reason] = rest;
      const [provider, model, effort] = String(combo || '').split(':');
      if (!category || !provider || !model || !score) fail('Usage : orchestrate rescore <catégorie> <fournisseur>:<modèle>:<effort> <1-5> "<raison>"');
      await call('/api/orch/rescore', { category, provider, model, effort: effort || null, score: Number(score), why: reason.join(' ') });
      return console.log(`${provider === 'codex' ? 'GPT ' : ''}${model}·${effort || '-'} réévalué ${score}/5 en ${category}.`);
    }
    case 'skills': {
      const list = await call('/api/orch/skills');
      return console.log(list.map((s) => `${s.name} — ${s.description}`).join('\n'));
    }
    case 'launch': {
      const brief = flags.brief || (flags.briefFile ? fs.readFileSync(flags.briefFile, 'utf8') : readStdin());
      const phase = flags.phase && /^\d+$/.test(flags.phase) ? Number(flags.phase) - 1 : flags.phase;
      const r = await call('/api/orch/launch', { name: flags.name, kind: flags.kind, phase, provider: flags.provider, model: flags.model, effort: flags.effort, mode: flags.mode, skills: flags.skills, isolated: !!flags.isolated, brief });
      return console.log(`${r.id} lancé${r.branch ? ` dans son worktree ${r.cwd} (branche ${r.branch})` : ''}. Le cockpit t'écrira quand il aura fini son tour.`);
    }
    case 'read': {
      const r = await call(`/api/orch/read${q(`&id=${encodeURIComponent(rest[0] || '')}`)}`);
      const files = r.files.length ? `\nFichiers modifiés : ${r.files.join(', ')}` : '';
      return console.log(`${r.id} « ${r.name} » · ${STATUS[r.status]}${r.branch ? ` · branche ${r.branch}` : ''}${files}\n\n${r.report || '(aucun rapport pour l\'instant)'}`);
    }
    case 'send': {
      const r = await call('/api/orch/send', { id: rest[0], text: rest.slice(1).join(' ') || readStdin() });
      return console.log(r.delivery === 'queued' ? `Message mis en file : ${rest[0]} le lira à la fin de son tour.` : 'Message envoyé.');
    }
    case 'stop':
      await call('/api/orch/stop', { id: rest[0] });
      return console.log(`${rest[0]} arrêté.`);
    case 'resume':
      await call('/api/orch/resume', { id: rest[0], text: rest.slice(1).join(' ') });
      return console.log(`${rest[0]} relancé.`);
    default:
      fail(`Commande inconnue : ${command}\n\n${USAGE}`);
  }
}

main();
