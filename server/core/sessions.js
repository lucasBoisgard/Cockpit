const path = require('node:path');

const STALE_MS = 30 * 60 * 1000;

function withClaudeStatus(session, panes) {
  const claude = panes.claudeStatus?.get(session.sessionId);
  if (!(session.status === 'working' && claude?.status === 'idle' && claude.at > session.updatedAt)) return session;
  return { ...session, status: 'idle', statusSince: claude.at, workedMs: (session.workedMs || 0) + Math.max(0, session.updatedAt - (session.statusSince || session.updatedAt)) };
}

function effectiveStatus(session, panes, now) {
  const merged = withClaudeStatus(session, panes);
  if (merged.status !== 'working' || now - merged.updatedAt < STALE_MS) return merged;
  return { ...merged, status: 'idle', statusSince: merged.updatedAt, stale: true };
}

function turnStatus(session) {
  return session.stale || (session.agentsRunning > 0 && ['done', 'idle'].includes(session.status)) ? 'working' : session.status;
}

const EDITING_TOOLS = ['Edit', 'MultiEdit', 'Write', 'NotebookEdit'];

const OVERLAP_WINDOW_MS = 30 * 60 * 1000;

function primarySession(sessions) {
  const live = sessions.filter((s) => s.live);
  if (!live.length) return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
  const rank = (s) => (s.status === 'needs_input' ? 0 : turnStatus(s) === 'working' ? 1 : 2);
  return [...live].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)[0];
}

function sessionOverlap(sessions, now = Date.now()) {
  const editors = new Map();
  for (const session of sessions) {
    for (const action of session.actions || []) {
      if (action.at && now - action.at > OVERLAP_WINDOW_MS) continue;
      const files = action.tool === 'apply_patch' ? (action.files || []) : EDITING_TOOLS.includes(action.tool) && action.detail ? [action.detail] : [];
      for (const name of files) {
        const file = path.resolve(session.cwd || '/', name);
        if (!editors.has(file)) editors.set(file, new Set());
        editors.get(file).add(session.sessionId);
      }
    }
  }
  return [...editors].filter(([, ids]) => ids.size > 1).map(([file, ids]) => ({ file, sessions: [...ids] })).sort((a, b) => a.file.localeCompare(b.file));
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

const tmuxSessionName = (name, now) => `cw-${name.replace(/[.:]/g, '_')}-${now.toString(36).slice(-4)}`;

function reviewSystemPrompt(skills, reportFile) {
  return [
    'This session is a pull request review started from the Cockpit.',
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

function codexReviewPrompt(skills, reportFile) {
  return [
    'This session is a pull request review started from the Cockpit.',
    `Read these available review skill instructions when relevant: ${skills.join(', ')}. Begin with review-context when available, including the linked ticket and discussions. If access or a skill is unavailable, report the limitation.`,
    'Check findings against the code. Never post comments, approve or request changes on the pull request.',
    `Read the review-report skill and write the final report atomically to ${reportFile}; then summarize it in the conversation.`,
  ].join('\n');
}

module.exports = { STALE_MS, withClaudeStatus, effectiveStatus, turnStatus, primarySession, sessionOverlap, paneOf, ownerOf, shouldQueue, sessionEvent, delegatedDoneText, validName, validPrRef, tmuxSessionName, reviewSystemPrompt, codexReviewPrompt, reviewPrompt };
