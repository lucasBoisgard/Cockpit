// Claiming a pull request for review on a GitHub Projects board: the user becomes its Owner and the status moves to "In Review".

const DEFAULTS = { statusField: 'Status', ownerField: 'Owner', inReview: 'In Review' };

// `label`, when set, restricts claiming to pull requests carrying that label (a team's PRs).
// Off unless a project is named, either in `reviewClaim` or through the review board's own org and number.
function claimSettings(config) {
  const claim = config?.reviewClaim;
  if (!claim || claim.enabled === false) return null;
  const org = claim.org || config?.reviewBoard?.org;
  const number = Number(claim.number || config?.reviewBoard?.number);
  if (!org || !Number.isInteger(number) || number <= 0) return null;
  return { org: String(org), number, statusField: claim.statusField || DEFAULTS.statusField, ownerField: claim.ownerField || DEFAULTS.ownerField, inReview: claim.inReview || DEFAULTS.inReview, label: claim.label ? String(claim.label) : null };
}

const sameName = (a, b) => !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

// fields: the project's single-select fields as [{ id, name, options: [{ id, name }] }].
function planClaim(fields, user, settings) {
  const field = (name) => (fields || []).find((f) => sameName(f?.name, name) && Array.isArray(f.options));
  const owner = field(settings.ownerField);
  const status = field(settings.statusField);
  if (!owner) return { error: `Champ « ${settings.ownerField} » introuvable dans le projet, ou pas à sélection unique.` };
  if (!status) return { error: `Champ « ${settings.statusField} » introuvable dans le projet, ou pas à sélection unique.` };
  const ownerOption = owner.options.find((o) => sameName(o.name, user));
  if (!ownerOption) return { error: `${user} n’est pas une option du champ « ${settings.ownerField} » du projet.` };
  const statusOption = status.options.find((o) => sameName(o.name, settings.inReview));
  if (!statusOption) return { error: `Statut « ${settings.inReview} » introuvable dans le champ « ${settings.statusField} ».` };
  return { ownerFieldId: owner.id, ownerOptionId: ownerOption.id, statusFieldId: status.id, statusOptionId: statusOption.id };
}

const hasLabel = (labels, label) => !label || (labels || []).some((l) => sameName(l?.name, label));

module.exports = { claimSettings, planClaim, hasLabel, DEFAULTS };
