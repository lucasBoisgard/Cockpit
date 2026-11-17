const test = require('node:test');
const assert = require('node:assert');
const { claimSettings, planClaim } = require('../server/core/review-claim');

const FIELDS = [
  { id: 'F_STATUS', name: 'Status', options: [{ id: 'S1', name: 'To Review' }, { id: 'S2', name: 'In Review' }] },
  { id: 'F_OWNER', name: 'Owner', options: [{ id: 'O1', name: 'Alex' }, { id: 'O2', name: 'bob' }] },
  { id: 'F_TEXT', name: 'Notes' },
];

test('claiming is off without a named project and falls back to the review board project', () => {
  assert.strictEqual(claimSettings({}), null);
  assert.strictEqual(claimSettings({ reviewClaim: {} }), null);
  assert.strictEqual(claimSettings({ reviewBoard: { org: 'acme', number: 28 } }), null);
  assert.strictEqual(claimSettings({ reviewClaim: { org: 'acme', number: 28, enabled: false } }), null);
  assert.deepStrictEqual(claimSettings({ reviewClaim: { org: 'acme', number: '28' } }), { org: 'acme', number: 28, statusField: 'Status', ownerField: 'Owner', inReview: 'In Review', label: null });
  assert.deepStrictEqual(claimSettings({ reviewBoard: { org: 'acme', number: 3 }, reviewClaim: { inReview: 'Reviewing' } }), { org: 'acme', number: 3, statusField: 'Status', ownerField: 'Owner', inReview: 'Reviewing', label: null });
});

test('the plan picks the owner option matching the login and the in-review status, ignoring case', () => {
  const settings = claimSettings({ reviewClaim: { org: 'acme', number: 1 } });
  assert.deepStrictEqual(planClaim(FIELDS, 'alex', settings), { ownerFieldId: 'F_OWNER', ownerOptionId: 'O1', statusFieldId: 'F_STATUS', statusOptionId: 'S2' });
});

test('the plan explains what is missing in the project', () => {
  const settings = claimSettings({ reviewClaim: { org: 'acme', number: 1 } });
  assert.match(planClaim(FIELDS, 'carol', settings).error, /carol n’est pas une option/);
  assert.match(planClaim(FIELDS.slice(0, 1), 'alex', settings).error, /Owner/);
  assert.match(planClaim(FIELDS.slice(1), 'alex', settings).error, /Status/);
  assert.match(planClaim(FIELDS, 'alex', { ...settings, inReview: 'Nope' }).error, /Nope/);
});

const { createClaimReview } = require('../server/features/review-claim');
const { hasLabel } = require('../server/core/review-claim');

const SETTINGS = claimSettings({ reviewClaim: { org: 'acme', number: 1, label: 'TEAM' } });
const ok = (stdout) => ({ ok: true, stdout: JSON.stringify(stdout), stderr: '' });

// A fake gh: `items` is what the PR already has on the board; the values written are replayed by the read-back.
function fakeGh({ labels = [{ name: 'team' }], items = [], data, prView, user = 'alex' } = {}) {
  const calls = [];
  const written = {};
  const run = async (args) => {
    calls.push(args.slice(0, 2).join(' ') + ' ' + (args.find((a) => /^query=/.test(a)) || ''));
    if (args[0] === 'api' && args[1] === 'user') return { ok: true, stdout: `${user}\n`, stderr: '' };
    if (args[0] === 'pr') return prView || ok({ id: 'PR1', labels });
    const query = args.find((a) => /^query=/.test(a));
    if (/query\(\$org/.test(query)) return ok(data !== undefined ? data : { data: { organization: { projectV2: { id: 'P1', fields: { nodes: FIELDS } } }, node: { projectItems: { nodes: items } } } });
    if (/updateProjectV2ItemFieldValue/.test(query)) { written.owner = 'alex'; written.status = 'In Review'; return ok({ data: {} }); }
    return ok({ data: { node: { owner: { name: written.owner }, status: { name: written.status } } } });
  };
  return { run, calls };
}

test('claiming only applies to pull requests carrying the configured label', () => {
  assert.strictEqual(hasLabel([{ name: 'FORMATION' }], 'formation'), true);
  assert.strictEqual(hasLabel([{ name: 'OTHER' }], 'FORMATION'), false);
  assert.strictEqual(hasLabel([], null), true);
});

test('a pull request of another team is left alone and never touches the board', async () => {
  const gh = fakeGh({ labels: [{ name: 'OTHER' }] });
  assert.deepStrictEqual(await createClaimReview({ settings: SETTINGS, run: gh.run })('12'), {});
  assert.ok(!gh.calls.some((c) => /graphql/.test(c)));
});

test('a team pull request missing from the board is left alone: no write, no warning', async () => {
  const gh = fakeGh();
  assert.deepStrictEqual(await createClaimReview({ settings: SETTINGS, run: gh.run })('#12'), {});
  assert.ok(gh.calls.some((c) => /query\(\$org/.test(c)));
  assert.ok(!gh.calls.some((c) => /mutation/.test(c)));
  assert.deepStrictEqual(await createClaimReview({ settings: SETTINGS, run: fakeGh({ user: 'carol' }).run })('12'), {});
});

test('a pull request already on the board is claimed and verified, never added', async () => {
  const gh = fakeGh({ items: [{ id: 'I9', project: { id: 'P1' } }] });
  assert.deepStrictEqual(await createClaimReview({ settings: SETTINGS, run: gh.run })('12'), {});
  assert.ok(gh.calls.some((c) => /updateProjectV2ItemFieldValue/.test(c)));
  assert.ok(!gh.calls.some((c) => /addProjectV2ItemById/.test(c)));
});

test('failures come back as a warning and never throw', async () => {
  const claim = (opts) => createClaimReview({ settings: SETTINGS, run: fakeGh(opts).run })('12');
  assert.match((await claim({ prView: { ok: true, stdout: 'not json', stderr: '' } })).warning, /Projet de review non mis à jour/);
  assert.match((await claim({ data: { data: null } })).warning, /vide/);
  assert.match((await claim({ user: 'carol', items: [{ id: 'I9', project: { id: 'P1' } }] })).warning, /carol/);
  assert.deepStrictEqual(await createClaimReview({ settings: null, run: fakeGh().run })('12'), {});
});
