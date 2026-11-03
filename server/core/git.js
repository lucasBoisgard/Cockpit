const path = require('node:path');

const validSha = (sha) => /^[0-9a-f]{40}$/.test(String(sha || ''));

function parseWorktreeList(out) {
  return (out || '')
    .split('\n\n')
    .map((block) => {
      const wt = {};
      for (const line of block.split('\n')) {
        const [key, ...rest] = line.split(' ');
        const value = rest.join(' ');
        if (key === 'worktree') wt.path = value;
        if (key === 'branch') wt.branch = value.replace('refs/heads/', '');
        if (key === 'HEAD') wt.head = value;
        if (key === 'detached') wt.detached = true;
        if (key === 'locked') {
          const claude = value.match(/^claude session .* \(pid (\d+) start (\d+)\)$/);
          if (claude) wt.claudeLock = { pid: Number(claude[1]), start: claude[2] };
          else wt.locked = true;
        }
        if (key === 'prunable') wt.prunable = true;
      }
      return wt;
    })
    .filter((wt) => wt.path && !wt.prunable);
}

function parseStatus(out) {
  const files = [];
  let ahead = 0;
  let behind = 0;
  let upstream = null;
  for (const line of (out || '').split('\n')) {
    if (line.startsWith('# branch.ab ')) {
      const [, , a, b] = line.split(' ');
      ahead = Number(a);
      behind = -Number(b);
    } else if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length);
    } else if (line.startsWith('1 ')) {
      const parts = line.split(' ');
      files.push({ code: parts[1], path: parts.slice(8).join(' ') });
    } else if (line.startsWith('2 ')) {
      const parts = line.split(' ');
      files.push({ code: parts[1], path: parts.slice(9).join(' ').split('\t')[0] });
    } else if (line.startsWith('u ')) {
      const parts = line.split(' ');
      files.push({ code: 'UU', path: parts.slice(10).join(' ') });
    } else if (line.startsWith('? ')) {
      files.push({ code: '??', path: line.slice(2) });
    }
  }
  return { files, ahead, behind, upstream };
}

function parseNumstat(out) {
  const stats = {};
  for (const line of (out || '').split('\n')) {
    const [added, deleted, ...rest] = line.split('\t');
    if (!rest.length) continue;
    stats[rest.join('\t')] = { added: Number(added) || 0, deleted: Number(deleted) || 0 };
  }
  return stats;
}

function describeWorktree(wt, name, { status, numstat, lastCommit }, review) {
  const parsed = parseStatus(status);
  const stats = parseNumstat(numstat);
  const [subject, ts] = (lastCommit || '').trim().split('\0');
  const isUnstaged = (f) => f.code.charAt(1) !== '.';
  const files = parsed.files.filter(isUnstaged).map((f) => ({ ...f, ...(stats[f.path] || {}) }));
  return {
    name,
    path: wt.path,
    branch: wt.branch || null,
    head: wt.head ? wt.head.slice(0, 7) : null,
    headSha: wt.head || null,
    detached: !!wt.detached,
    locked: !!wt.locked,
    files,
    staged: parsed.files.filter((f) => f.code.charAt(0) !== '.' && !['??', 'UU'].includes(f.code)).length,
    added: files.reduce((sum, f) => sum + (f.added || 0), 0),
    deleted: files.reduce((sum, f) => sum + (f.deleted || 0), 0),
    ahead: parsed.ahead,
    behind: parsed.behind,
    upstream: parsed.upstream,
    lastCommit: subject ? { subject, at: Number(ts) * 1000 } : null,
    review,
    sessions: [],
  };
}

function repoLabel(remote, top) {
  const match = String(remote || '').trim().match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return match ? match[1] : path.basename(top);
}

function rangeSpec(range) {
  if (range === 'work') return { args: [] };
  if (range === 'branch' || range === 'pr') return { base: range };
  const commit = String(range).match(/^commit:([0-9a-f]{40})$/);
  return commit ? { args: [`${commit[1]}^!`] } : null;
}

function baseRefs(prBaseBranch, baseBranch) {
  const bases = [...new Set([prBaseBranch, baseBranch].filter(Boolean))];
  return { fetch: bases[0], refs: bases.flatMap((b) => [`origin/${b}`, b]) };
}

function parseChanges(numstat, names, untracked) {
  const stats = parseNumstat(numstat);
  const files = (names || '').split('\n').filter(Boolean).map((line) => {
    const [code, ...rest] = line.split('\t');
    const file = rest[rest.length - 1];
    return { code: code.charAt(0), path: file, ...(stats[file] || {}) };
  });
  return [...files, ...(untracked || '').split('\n').filter(Boolean).map((file) => ({ code: '??', path: file }))];
}

function parseCommitLog(log) {
  return (log || '').split('\n').filter(Boolean).map((line) => {
    const [sha, at, subject] = line.split('\x1f');
    return { sha, at: Number(at) * 1000, subject };
  });
}

module.exports = { validSha, parseWorktreeList, parseStatus, parseNumstat, describeWorktree, repoLabel, rangeSpec, baseRefs, parseChanges, parseCommitLog };
