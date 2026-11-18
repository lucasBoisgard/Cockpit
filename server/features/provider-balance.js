const { loadStore } = require('../io/store');
const { currentLimits, providerWork } = require('./usage');
const { providersInfo } = require('./providers');
const core = require('../core/provider-balance');

const STORE = 'worktree-orchestration.json';

const WEEK_MS = 7 * 86400000;

// Work since the start of each provider's current weekly window (its reset minus seven days); a rolling week when the reset is unknown.
function weekWork(limits, now = Date.now()) {
  const since = (p) => {
    const reset = limits?.[p]?.seven_day?.resets_at;
    return Number.isFinite(reset) && reset * 1000 > now ? reset * 1000 - WEEK_MS : now - WEEK_MS;
  };
  return providerWork({ claude: since('claude'), codex: since('codex') });
}

async function balanceState() {
  const info = await providersInfo();
  const limits = currentLimits();
  const balance = core.providerBalance({
    launches: core.choosableAgents(loadStore(STORE, {})),
    limits,
    available: { claude: info.claude.available, codex: info.codex.available },
    work: weekWork(limits),
  });
  return { ...balance, text: core.balanceText(balance) };
}

module.exports = { balanceState };
