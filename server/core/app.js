const CRASH_LOOP_UPTIME_MS = 15000;

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

const shellQuote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

function lastLineOf(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';
}

function parsePm2List(stdout, now) {
  const start = stdout.indexOf('[');
  if (start < 0) return null;
  return JSON.parse(stdout.slice(start))
    .filter((p) => !p.name.startsWith('version:'))
    .map((p) => {
      const env = p.pm2_env || {};
      const restarts = env.restart_time || 0;
      const looping = env.status === 'online' && restarts >= 3 && now - (env.pm_uptime || 0) < CRASH_LOOP_UPTIME_MS;
      const finished = env.status === 'stopped' && env.exit_code === 0;
      return { name: p.name, status: env.status, restarts, exitCode: env.exit_code ?? null, looping, finished };
    });
}

function parseBuildPane(info, tail) {
  const [dead, code, created] = info.trim().split('\t');
  const lastLine = stripAnsi(tail).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('Pane is dead')).pop() || '';
  return { running: dead !== '1', exitCode: dead === '1' ? Number(code) : null, startedAt: Number(created) * 1000, lastLine: lastLine.slice(0, 160) };
}

function appVerdict(base, { build, processes, code, healthUrl }) {
  const answering = code === null ? null : !!code && code !== 503;
  if (build && !build.running && build.exitCode !== 0) return { ...base, state: 'ko', reason: `La commande de lancement a échoué (code ${build.exitCode})` };
  if (build?.running && answering !== true) return { ...base, state: 'building' };
  if (!build?.running && !processes.length && answering !== true) return { ...base, state: 'stopped' };
  const failed = processes.filter((p) => p.status !== 'online' && !p.finished);
  const looping = processes.filter((p) => p.looping);
  const warnings = [
    failed.length ? `Process arrêtés : ${failed.map((p) => `${p.name}${p.exitCode ? ` (code ${p.exitCode})` : ''}`).join(', ')}` : null,
    looping.length ? `Redémarrent en boucle : ${looping.map((p) => `${p.name} (${p.restarts}×)`).join(', ')}` : null,
  ].filter(Boolean);
  if (answering === false && warnings.length) return { ...base, state: 'ko', reason: warnings.join(' · '), warnings };
  if (answering === false) return { ...base, state: 'starting', reason: code ? `${healthUrl} répond encore 503` : `${healthUrl} ne répond pas encore`, warnings };
  if (warnings.length) return { ...base, state: 'degraded', reason: warnings.join(' · '), warnings };
  return { ...base, state: 'up', warnings };
}

const isRunning = (state) => ['up', 'degraded', 'starting'].includes(state);

function startRefusal(current, restart) {
  if (!current) return "Aucune app configurée (app.command dans cockpit.config.json).";
  if (current.state === 'building') return 'Un build est déjà en cours.';
  if (isRunning(current.state) && !restart) return "L'app tourne déjà.";
  return null;
}

function launchCommand({ command, migrationsCommand, pending, storeFile }) {
  if (!pending) return command;
  const markMigrated = `printf '{"fingerprint":"%s","at":%s}' ${shellQuote(pending)} "$(date +%s000)" > ${shellQuote(storeFile)}`;
  return `${command} && ${migrationsCommand} && ${markMigrated}`;
}

function survivorsError(survivors) {
  const list = survivors.map(({ pid, ports, cmd }) => `${pid}${ports.length ? ` (port ${ports.join(', ')})` : ''} ${cmd}`).join(' · ');
  return `Process de l'app toujours vivants après SIGKILL : ${list}`;
}

const appWentKo = (before, now) => !!before && before !== 'ko' && now === 'ko';

module.exports = { stripAnsi, shellQuote, lastLineOf, parsePm2List, parseBuildPane, appVerdict, isRunning, startRefusal, launchCommand, survivorsError, appWentKo };
