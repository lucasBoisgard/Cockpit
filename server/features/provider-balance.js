const { CONFIG } = require('../config');
const { loadStore } = require('../io/store');
const { currentLimits } = require('./usage');
const { providersInfo } = require('./providers');
const core = require('../core/provider-balance');

const STORE = 'worktree-orchestration.json';

async function balanceState() {
  const info = await providersInfo();
  const target = Number(CONFIG.balance?.codexShare);
  const balance = core.providerBalance({
    launches: core.choosableAgents(loadStore(STORE, {})),
    limits: currentLimits(),
    available: { claude: info.claude.available, codex: info.codex.available },
    target: Number.isFinite(target) && target > 0 && target < 1 ? target : core.DEFAULT_TARGET,
  });
  return { ...balance, text: core.balanceText(balance) };
}

module.exports = { balanceState };
