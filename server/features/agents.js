const fs = require('node:fs');
const path = require('node:path');
const { readJson, readSession } = require('../io/store');
const { readTail, subdirs } = require('../io/files');
const { emptyActivity, applyText, emptyProgress, applyJournal, agentTree, countRunning, countActive } = require('../core/agents');
const { effectiveStatus } = require('../core/sessions');
const { transcriptFor } = require('./chat');
const { builtinCommandNames } = require('./commands');

const MAIN_WINDOW = 4 * 1024 * 1024;
const JOURNAL_WINDOW = 64 * 1024 * 1024;
const AGENT_WINDOW = 1024 * 1024;
const RECENT_MS = 5 * 60 * 1000;
const RECENT_DIR_MS = 2 * 3600 * 1000;
const readers = new Map();

function follow(file, stat, window, init, apply, now) {
  let reader = readers.get(file);
  if (!reader || stat.size < reader.offset || stat.ino !== reader.ino) {
    const offset = Math.max(0, stat.size - window);
    reader = { ino: stat.ino, offset, rest: Buffer.alloc(0), skipFirst: offset > 0, value: init() };
    readers.set(file, reader);
  }
  reader.seenAt = now;
  if (stat.size > reader.offset) {
    let bytes = Buffer.concat([reader.rest, readTail(file, reader.offset, stat.size)]);
    reader.offset = stat.size;
    if (reader.skipFirst) {
      bytes = bytes.subarray(bytes.indexOf(0x0a) + 1);
      reader.skipFirst = false;
    }
    const cut = bytes.lastIndexOf(0x0a) + 1;
    reader.rest = Buffer.from(bytes.subarray(cut));
    apply(reader.value, bytes.subarray(0, cut).toString('utf8'));
  }
  return reader.value;
}

function forgetOld(now) {
  for (const [file, reader] of readers) if (now - reader.seenAt > RECENT_DIR_MS) readers.delete(file);
}

const activityOf = (file, stat, window, now) => follow(file, stat, window, emptyActivity, (activity, text) => applyText(activity, text, builtinCommandNames), now);
const journalOf = (file, stat, now) => follow(file, stat, JOURNAL_WINDOW, emptyProgress, applyJournal, now);

function agentsIn(dir, workflowId, now) {
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((name) => /^agent-[\w-]+\.jsonl$/.test(name));
  } catch {}
  return names.flatMap((name) => {
    const file = path.join(dir, name);
    const stat = fs.statSync(file, { throwIfNoEntry: false });
    if (!stat || now - stat.mtimeMs > RECENT_DIR_MS) return [];
    const id = name.slice('agent-'.length, -'.jsonl'.length);
    const meta = readJson(path.join(dir, `agent-${id}.meta.json`)) || {};
    if (meta.finished === true && now - stat.mtimeMs > RECENT_MS) return [];
    return [{ id, workflowId, meta, activity: activityOf(file, stat, AGENT_WINDOW, now), mtime: stat.mtimeMs, started: stat.birthtimeMs || stat.ctimeMs }];
  });
}

function subagentsOf(transcript, now) {
  const dir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
  const workflowsDir = path.join(dir, 'workflows');
  const workflows = new Map();
  const agents = agentsIn(dir, null, now);
  for (const id of subdirs(workflowsDir)) {
    const journal = path.join(workflowsDir, id, 'journal.jsonl');
    const stat = fs.statSync(journal, { throwIfNoEntry: false });
    if (!stat || now - stat.mtimeMs > RECENT_DIR_MS) continue;
    workflows.set(id, journalOf(journal, stat, now));
    agents.push(...agentsIn(path.join(workflowsDir, id), id, now));
  }
  return { agents, workflows };
}

function agentsRunning(session, now = Date.now()) {
  if (!session.live || !['done', 'idle'].includes(session.status)) return 0;
  const transcript = transcriptFor(session);
  if (!transcript || !fs.existsSync(path.join(transcript.replace(/\.jsonl$/, ''), 'subagents'))) return 0;
  const { agents, workflows } = subagentsOf(transcript, now);
  if (!agents.length) return 0;
  return countActive(agentTree({ main: { status: session.status, activity: null }, agents, workflows, now }), session.updatedAt, now);
}

function agentsOf(sessionId, now = Date.now()) {
  const session = readSession(String(sessionId || ''));
  const transcript = transcriptFor(session);
  if (!transcript) return null;
  const { agents, workflows } = subagentsOf(transcript, now);
  const last = session.actions?.[0];
  const status = effectiveStatus(session, {}, now).status;
  const stat = fs.statSync(transcript, { throwIfNoEntry: false });
  const activity = stat ? activityOf(transcript, stat, MAIN_WINDOW, now) : null;
  const main = { task: activity?.prompt || session.task, status, action: last ? { tool: last.tool, detail: last.detail } : null, activity };
  forgetOld(now);
  const tree = agentTree({ main, agents, workflows, now });
  return { tree, running: countRunning(tree) };
}

module.exports = { agentsOf, agentsRunning, forgetOld, follow };
