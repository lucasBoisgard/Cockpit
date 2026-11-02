const STALE_MS = 30 * 60 * 1000;

function withClaudeStatus(session, panes) {
  const claude = panes.claudeStatus?.get(session.sessionId);
  if (!(session.status === 'working' && claude?.status === 'idle' && claude.at > session.updatedAt)) return session;
  return { ...session, status: 'idle', statusSince: claude.at, workedMs: (session.workedMs || 0) + Math.max(0, session.updatedAt - (session.statusSince || session.updatedAt)) };
}

function effectiveStatus(session, panes, now) {
  const merged = withClaudeStatus(session, panes);
  if (merged.status !== 'working' || now - merged.updatedAt < STALE_MS) return merged;
  return { ...merged, status: 'idle', statusSince: merged.updatedAt };
}

function paneOf(session, panes) {
  if (!session) return null;
  const pane = session.tmuxPane && session.status !== 'ended' ? panes.get(session.tmuxPane) : null;
  if (pane && !(session.tmuxPaneSince && pane.created > session.tmuxPaneSince + 5000)) return session.tmuxPane;
  return panes.bySession?.get(session.sessionId) || null;
}

function ownerOf(cwd, worktrees) {
  return worktrees
    .filter((wt) => cwd === wt.path || cwd.startsWith(`${wt.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

function shouldQueue(session, queueWhenWaiting, now, staleMs) {
  const busy = session.status === 'working' || (queueWhenWaiting && session.status === 'needs_input');
  return busy && now - session.updatedAt < staleMs;
}

function sessionEvent(before, session) {
  if (before === undefined || before === session.status) return null;
  if (session.status === 'needs_input') {
    const type = session.question ? 'question' : session.permission ? 'permission' : 'needs_input';
    return { type, message: session.message || 'Claude attend ta réponse' };
  }
  if (session.status === 'done' && before === 'working') return { type: 'done', message: session.lastAssistant || 'Tour terminé' };
  return null;
}

function delegatedDoneText(name, lastAssistant) {
  return `La session déléguée « ${name} » a terminé son tour. Son dernier message :\n\n${lastAssistant || '(pas de message)'}`;
}

function validName(name) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/.test(name);
}

const validPrRef = (ref) => /^(https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+(\/[\w./-]*)?|#?\d+)$/.test(ref);

const tmuxSessionName = (name, now) => `cw-${name}-${now.toString(36).slice(-4)}`;

function reviewSystemPrompt(skills, reportFile) {
  return [
    'This session is a pull request review started from the worktree cockpit.',
    `Review skills available in this session: ${skills.join(', ')}.`,
    'Start with the review-context skill: read the ticket linked in the pull request, its comments and the Slack threads they point to, before judging any code.',
    'Before reading the pull request, load with the Skill tool the review skills that fit it: always code-review, plus the specialised ones whose description matches what the pull request touches. Run them, then check every finding against the code before keeping it.',
    'Never post, comment, approve or request changes on the pull request yourself.',
    `When the review is done, write the report with the review-report skill to ${reportFile}: the cockpit renders it as colored blocks, one per finding. Then give a short summary in the conversation.`,
  ].join('\n');
}

function reviewPrompt(prRef, prompt) {
  return `Review the pull request ${prRef}.${prompt && String(prompt).trim() ? `\n\n${String(prompt).trim()}` : ''}`;
}

module.exports = { STALE_MS, withClaudeStatus, effectiveStatus, paneOf, ownerOf, shouldQueue, sessionEvent, delegatedDoneText, validName, validPrRef, tmuxSessionName, reviewSystemPrompt, reviewPrompt };
