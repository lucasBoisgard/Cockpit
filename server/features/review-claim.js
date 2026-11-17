const { REPO, CONFIG } = require('../config');
const { gh, ghAvailable } = require('../io/exec');
const { claimSettings, planClaim, hasLabel } = require('../core/review-claim');

const GH_TIMEOUT_MS = 8000;
const CLAIM_TIMEOUT_MS = 15000;

const READ = `query($org: String!, $number: Int!, $pr: ID!) {
  organization(login: $org) {
    projectV2(number: $number) {
      id
      fields(first: 50) { nodes { ... on ProjectV2SingleSelectField { id name options { id name } } } }
    }
  }
  node(id: $pr) { ... on PullRequest { projectItems(first: 50) { nodes { id project { id } } } } }
}`;
const SET = `mutation($project: ID!, $item: ID!, $owner: ID!, $ownerOption: String!, $status: ID!, $statusOption: String!) {
  owner: updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $owner, value: { singleSelectOptionId: $ownerOption } }) { projectV2Item { id } }
  status: updateProjectV2ItemFieldValue(input: { projectId: $project, itemId: $item, fieldId: $status, value: { singleSelectOptionId: $statusOption } }) { projectV2Item { id } }
}`;
const CHECK = `query($item: ID!, $ownerField: String!, $statusField: String!) {
  node(id: $item) { ... on ProjectV2Item {
    owner: fieldValueByName(name: $ownerField) { ... on ProjectV2ItemFieldSingleSelectValue { name } }
    status: fieldValueByName(name: $statusField) { ... on ProjectV2ItemFieldSingleSelectValue { name } }
  } }
}`;


// Built around an injectable `gh` runner so the flow can be tested without GitHub.
function createClaimReview({ settings, run, available = true }) {
  let me = null;

  async function graphql(query, vars) {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [key, value] of Object.entries(vars)) args.push(typeof value === 'number' ? '-F' : '-f', `${key}=${value}`);
    const result = await run(args);
    if (!result.ok) return { error: /INSUFFICIENT_SCOPES|required scopes/i.test(result.stderr) ? 'gh n’a pas le scope project (gh auth refresh -s project)' : result.stderr.trim().split('\n').pop().slice(0, 160) };
    try {
      const body = JSON.parse(result.stdout);
      if (body.errors?.length) return { error: String(body.errors[0].message).slice(0, 160) };
      return body.data ? { data: body.data } : { error: 'Réponse GitHub vide.' };
    } catch {
      return { error: 'Réponse GitHub illisible.' };
    }
  }

  async function login() {
    if (me) return me;
    const result = await run(['api', 'user', '--jq', '.login']);
    me = result.ok ? result.stdout.trim() || null : null;
    return me;
  }

  async function claim(prRef) {
    const fail = (error) => ({ warning: `Projet de review non mis à jour : ${error}` });
    const user = await login();
    if (!user) return fail('gh n’est pas connecté à GitHub (gh auth status)');
    const view = await run(['pr', 'view', String(prRef).replace(/^#/, ''), '--json', 'id,labels']);
    if (!view.ok) return fail(`PR introuvable (${view.stderr.trim().split('\n').pop().slice(0, 120)})`);
    const pr = JSON.parse(view.stdout);
    if (!pr.id) return fail('PR introuvable');
    if (!hasLabel(pr.labels, settings.label)) return {};
    const prId = pr.id;
    const read = await graphql(READ, { org: settings.org, number: settings.number, pr: prId });
    if (read.error) return fail(read.error);
    const project = read.data.organization?.projectV2;
    if (!project) return fail(`projet ${settings.org}/${settings.number} introuvable`);
    // The cockpit never adds a PR to the board: one that is not on it is left alone, silently.
    const itemId = read.data.node?.projectItems?.nodes?.find((i) => i.project?.id === project.id)?.id;
    if (!itemId) return {};
    const plan = planClaim(project.fields?.nodes, user, settings);
    if (plan.error) return fail(plan.error);
    const set = await graphql(SET, { project: project.id, item: itemId, owner: plan.ownerFieldId, ownerOption: plan.ownerOptionId, status: plan.statusFieldId, statusOption: plan.statusOptionId });
    if (set.error) return fail(set.error);
    const check = await graphql(CHECK, { item: itemId, ownerField: settings.ownerField, statusField: settings.statusField });
    if (check.error) return fail(`écriture non vérifiée (${check.error})`);
    const { owner, status } = check.data.node || {};
    if (owner?.name?.toLowerCase() !== user.toLowerCase() || status?.name?.toLowerCase() !== settings.inReview.toLowerCase()) return fail('la vérification après écriture ne correspond pas');
    return {};
  }

  // Best effort: never throws and never waits more than CLAIM_TIMEOUT_MS, so a review session always starts.
  return async function claimReview(prRef) {
    if (!settings || !available) return {};
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ warning: 'Projet de review non mis à jour : délai dépassé' }), CLAIM_TIMEOUT_MS); });
    try {
      return await Promise.race([claim(prRef), timeout]);
    } catch (error) {
      return { warning: `Projet de review non mis à jour : ${String(error.message).slice(0, 160)}` };
    } finally {
      clearTimeout(timer);
    }
  };
}

const claimReview = createClaimReview({ settings: claimSettings(CONFIG), run: (args) => gh(REPO, args, { timeout: GH_TIMEOUT_MS }), available: ghAvailable });

module.exports = { claimReview, createClaimReview };
