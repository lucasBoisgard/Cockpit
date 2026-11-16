const LAST_ANSWER_MAX_CHARS = 3000;
const TASK_MAX_CHARS = 600;

const clip = (text, max) => {
  const value = String(text || '').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

// Why a worktree cannot be merged into another one, or null when it can.
function mergeRefusal(source, target, sameRepo) {
  if (!source || !target) return 'Worktree inconnu.';
  if (source.path === target.path) return 'Un worktree ne peut pas être fusionné dans lui-même.';
  if (source.mainCheckout) return 'Un checkout principal ne peut pas être fusionné : il ne peut pas être retiré.';
  if (source.locked) return 'Ce worktree est verrouillé (git worktree unlock pour le libérer).';
  if (!sameRepo) return 'Les deux worktrees doivent appartenir au même repo.';
  return null;
}

// A Claude running outside tmux can be neither stopped nor written to by the cockpit.
function runsOutsideCockpit({ sessions, liveIds, outsideIds, lockAlive }) {
  if (sessions.some((s) => outsideIds.has(s.sessionId) && !liveIds.has(s.sessionId))) return true;
  return lockAlive && !sessions.some((s) => liveIds.has(s.sessionId));
}

// How the target gets the handoff: its live session, else its last resumable conversation, else a new
// session. Sessions whose folder is gone (removed worktrees fall back to the main checkout) are skipped.
function pickDelivery({ sessions, liveIds, outsideIds, lockAlive, cwdExists }) {
  const recent = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const live = recent.find((s) => liveIds.has(s.sessionId));
  if (live) return { kind: 'live', sessionId: live.sessionId };
  if (runsOutsideCockpit({ sessions, liveIds, outsideIds, lockAlive })) return { error: 'Une session Claude ouverte hors cockpit tient la cible : quitte-la (/exit) puis réessaie.' };
  const resumable = recent.find((s) => s.hasTranscript && cwdExists(s.cwd));
  return resumable ? { kind: 'resume', sessionId: resumable.sessionId, provider: resumable.provider } : { kind: 'start' };
}

// The message the target session receives: enough to carry on, plus the transcripts to read for the rest.
function handoffText({ source, target, branch, head, upstream, base, commits, sessions }) {
  const lines = [
    `[cockpit] Fusion : le worktree « ${source} » est fusionné dans celui-ci (« ${target} ») et vient d’être archivé ; seule cette session continue. Reprends son contexte ci-dessous et considère son travail comme le tien.`,
    '',
    `Branche : ${branch || '(détachée)'}${head ? ` @ ${head}` : ''}${upstream ? ` (suit ${upstream})` : ' (jamais poussée)'}. Elle est conservée${branch ? ` : son code n’est pas dans ta branche, récupère-le au besoin (git merge ${branch}, jamais de rebase)` : ''}.`,
  ];
  if (commits.length) {
    lines.push(upstream ? `Commits non poussés (${commits.length}) :` : `Commits depuis ${base || 'la base'} (${commits.length}) :`);
    lines.push(...commits.map((c) => `- ${c}`));
  } else if (upstream) {
    lines.push('Tout est poussé.');
  }
  for (const [index, session] of sessions.entries()) {
    lines.push('', `Session ${index + 1}/${sessions.length}${session.task ? ` — demande : ${clip(session.task, TASK_MAX_CHARS)}` : ''}`);
    if (session.lastAssistant) lines.push(`Dernière réponse :\n${clip(session.lastAssistant, LAST_ANSWER_MAX_CHARS).replace(/^/gm, '> ')}`);
    if (session.transcriptPath) lines.push(`Conversation complète (JSONL, à lire au besoin) : ${session.transcriptPath}`);
  }
  if (!sessions.length) lines.push('', 'Aucune conversation dans ce worktree.');
  lines.push('', 'Fais d’abord un point en quelques lignes de ce que tu reprends et de ce qui reste à faire.');
  return lines.join('\n');
}

module.exports = { mergeRefusal, runsOutsideCockpit, pickDelivery, handoffText };
