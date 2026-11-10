const { ARENA_LIMIT_PERCENT } = require('../config');
const { arenaBlock, blockReason, refusalText } = require('../core/arena-breaker');
const { currentLimits } = require('./usage');
const { readStore, updateSettings } = require('./orchestration');
const { pushEvent } = require('./events');

const activeBlock = () => arenaBlock(currentLimits(), ARENA_LIMIT_PERCENT, Date.now());

// Turns Arena off in every live orchestration once the fullest usage window reaches the threshold. It never turns it back on.
async function cutArenaIfOverLimit() {
  const block = activeBlock();
  if (!block) return [];
  const targets = Object.values(readStore()).filter((o) => o.settings?.arena && !o.endedAt && !o.archivedOf);
  const cut = [];
  for (const orch of targets) {
    const result = await updateSettings({ master: orch.masterSessionId, arena: false, reason: blockReason(block) });
    if (!result.error) cut.push(orch.masterSessionId);
  }
  if (cut.length) pushEvent({ worktree: 'cockpit', type: 'arena_cut', message: `Mode Arène coupé sur ${cut.length} orchestration${cut.length > 1 ? 's' : ''} : ${blockReason(block)}` });
  return cut;
}

// Wraps a route that can switch Arena on: refused while the usage is over the threshold.
function refuseArenaIfOverLimit(wantsArena) {
  if (!wantsArena) return null;
  const block = activeBlock();
  return block ? { error: refusalText(block) } : null;
}

const isTrue = (v) => v === true || v === 'true';

const guarded = {
  arena: (run) => (body) => refuseArenaIfOverLimit(body.on === true) || run(body),
  create: (run) => (body) => refuseArenaIfOverLimit(isTrue(body.arena)) || run(body),
  settings: (run) => (body) => refuseArenaIfOverLimit(isTrue(body.arena) && !readStore()[String(body.master || '')]?.settings?.arena) || run(body),
};

module.exports = { cutArenaIfOverLimit, refuseArenaIfOverLimit, guarded };
