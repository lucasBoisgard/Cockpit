// Token budget of one long-lived agent: its session context is re-read at every turn, so past a point
// a fresh agent with a short handover costs far less than resuming the same one.

const DEFAULT_TOKEN_BUDGET_M = 15;
const MAX_TOKEN_BUDGET_M = 500;

const budgetTokens = (budgetM) => Math.round((Number(budgetM) || 0) * 1e6);

function budgetState(tokens, budgetM) {
  const budget = budgetTokens(budgetM);
  const used = Number(tokens) || 0;
  return { tokens: used, budget, over: budget > 0 && used > budget };
}

function formatM(tokens) {
  const m = tokens / 1e6;
  return `${m >= 100 ? Math.round(m) : Math.round(m * 10) / 10} M`.replace('.', ',');
}

const budgetLabel = (budgetM) => (budgetM > 0 ? `${budgetM} M tok` : 'sans plafond');

const overBudgetLabel = (state) => `${formatM(state.tokens)} tok > budget ${formatM(state.budget)}`;

function budgetWarning(agentId, state) {
  return `⚠ ${agentId} a consommé ${overBudgetLabel(state)} : son contexte est relu à chaque tour. Relance plutôt le travail dans un agent neuf avec un court passage de relais (objectif, état, reste à faire) au lieu de lui écrire ou de le reprendre.`;
}

function wakeBudgetLine(agentId, state) {
  return `⚠ Budget dépassé (${overBudgetLabel(state)}) : ne fais pas de send/resume sur ${agentId}. Relance le travail dans un agent neuf avec un court passage de relais (objectif, état, reste à faire).`;
}

module.exports = { DEFAULT_TOKEN_BUDGET_M, MAX_TOKEN_BUDGET_M, budgetTokens, budgetState, formatM, budgetLabel, overBudgetLabel, budgetWarning, wakeBudgetLine };
