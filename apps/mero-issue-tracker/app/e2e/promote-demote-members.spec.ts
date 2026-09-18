// Promote / demote a workspace member, driven through the UI and verified
// against the admin API on BOTH nodes.
//
// Why the assertions are admin-API reads rather than UI assertions: the whole
// failure mode this covers is a promotion that changes the promoter's screen and
// nothing else. A test that clicks "Admin" and then asserts the select says
// "Admin" would pass against a purely local state update, which is precisely the
// bug. So the UI drives, and the node is asked.
//
// Three things are pinned here:
//   1. the role lands on node 0 (the promoter's own node);
//   2. the per-member capability OVERRIDE is UNCHANGED by the promotion — the
//      invariant `apps/mero-drive/logic/workflows/probes/
//      workflow-mero-drive-members.yml` asserts against live nodes, and the
//      reason `setRole` must write the role and nothing else. Writing a mask
//      alongside it would survive a later demote and leave an ex-admin holding
//      an admin's bits;
//   3. the role REACHES NODE 1 — the promoted person's own node. A grant only
//      the granter can see confers nothing.
import { test, expect, type Page } from '@playwright/test';
import { loginViaHash, clearAuth, createWorkspace, inviteAndJoin, getNode } from './helpers';

interface GroupMemberRow {
  identity: string;
  role: string;
}

async function adminGet(nodeIndex: number, apiPath: string): Promise<any> {
  const node = getNode(nodeIndex);
  const res = await fetch(`${node.adminUrl}${apiPath}`, {
    headers: { Authorization: `Bearer ${node.accessToken}` },
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/** The roster as a node sees it. `members` is the documented field; `data` is
 *  the deprecated alias some builds still send. */
async function listMembers(nodeIndex: number, nsId: string): Promise<GroupMemberRow[]> {
  const json = await adminGet(nodeIndex, `/admin-api/groups/${nsId}/members`);
  return json?.data?.members ?? json?.members ?? json?.data ?? [];
}

/** Poll until `account` holds `role` on this node, or give up and return what
 *  it actually says — so the failure message names the real value. */
async function waitForRole(
  nodeIndex: number,
  nsId: string,
  account: string,
  role: string,
  timeoutMs: number,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  let seen: string | undefined;
  while (Date.now() < deadline) {
    const rows = await listMembers(nodeIndex, nsId);
    seen = rows.find((m) => m.identity === account)?.role;
    if (seen && seen.toLowerCase() === role.toLowerCase()) return seen;
    await new Promise((r) => setTimeout(r, 750));
  }
  return seen;
}

async function memberCapabilities(
  nodeIndex: number,
  nsId: string,
  account: string,
): Promise<number | null> {
  const json = await adminGet(
    nodeIndex,
    `/admin-api/groups/${nsId}/members/${account}/capabilities`,
  );
  const caps = json?.data?.capabilities ?? json?.capabilities;
  return typeof caps === 'number' ? caps : null;
}

/**
 * The workspace the page is looking at.
 *
 * POLLED, not read once. `activeNs` is persisted only on an explicit selection,
 * so immediately after the join flow the value can still be in-memory while the
 * page settles — which failed this test on its first attempt and then passed on
 * the retry. A retry-rescued test is not a passing test: it hides exactly this
 * kind of ordering assumption, so the wait is explicit here instead.
 */
async function activeNamespace(page: Page): Promise<string> {
  await expect
    .poll(
      () => page.evaluate(() => window.localStorage.getItem('issue-tracker:activeNs:v2')),
      {
        message: 'the inviter never persisted an active workspace',
        timeout: 30_000,
      },
    )
    .toBeTruthy();
  const nsId = await page.evaluate(() =>
    window.localStorage.getItem('issue-tracker:activeNs:v2'),
  );
  return nsId as string;
}

test.describe('promote and demote a workspace member', () => {
  test('an admin promotes a member to Admin and demotes them back', async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    try {
      await loginViaHash(pageA, 0);
      await loginViaHash(pageB, 1);
      await inviteAndJoin(pageA, pageB);

      const nsId = await activeNamespace(pageA);

      await pageA.getByTestId('nav-members').click();
      await expect(pageA.getByTestId('member-row').first()).toBeVisible({ timeout: 30_000 });

      // ── Governance first, UI second ──────────────────────────────────────
      //
      // Asserted against the admin API before touching a control, so a failure
      // says WHICH layer is wrong. The UI only ever reflects this state; if the
      // roster does not say what we expect, no amount of looking at the page
      // will explain why the Role control is missing.
      //
      // Every assertion carries the whole roster in its message, because the
      // interesting failures here are "the role is not the string we expected"
      // and "the member we are looking for is not in the list" — and neither is
      // diagnosable from a boolean.
      const roster = await listMembers(0, nsId);
      const rosterText = JSON.stringify(roster);

      expect(roster.length, `node 0 roster should hold two members: ${rosterText}`)
        .toBeGreaterThanOrEqual(2);

      // Who we are, taken from the row the app marked "You" — the ACCOUNT, which
      // is what governance is keyed by (a context executor key is also 64 hex
      // and names nobody here).
      const selfAccount = await pageA
        .locator('[data-testid="member-row"]', { has: pageA.locator('.you-badge') })
        .getAttribute('data-account');
      expect(selfAccount, 'the members table marks no row as "You"').toBeTruthy();

      // The workspace CREATOR must be an admin of it, or nobody can ever manage
      // anybody — this is the precondition the Role control is gated on.
      const creatorRole = roster.find((m) => m.identity === selfAccount)?.role;
      expect(
        creatorRole,
        `the workspace creator is not an Admin on node 0 — roster: ${rosterText}`,
      ).toBe('Admin');

      const target = roster.find((m) => m.identity !== selfAccount);
      expect(target, `no second member in the roster: ${rosterText}`).toBeTruthy();
      const account = (target as GroupMemberRow).identity;

      // Only now the UI: with an Admin viewer and another member present, the
      // control has to be there.
      //
      // The roster is eventually consistent from the page's side — the node
      // already has both members (asserted above), but the app learns about the
      // join from a refetch. So wait for the row before asserting the control
      // inside it, which keeps a failure here meaning "the control is missing"
      // rather than "the list had not caught up yet".
      await expect(pageA.getByTestId('member-row')).toHaveCount(roster.length, {
        timeout: 30_000,
      });
      const roleSelect = pageA
        .locator(`[data-testid="member-role-select"][data-account="${account}"]`);
      await expect(roleSelect).toBeVisible({ timeout: 30_000 });
      await expect(roleSelect).toHaveValue('Member');

      // Baseline: the per-member override before anything happens. A brand-new
      // member has none, which core reports as 0 — that is "no override", not
      // "no permissions".
      const overrideBefore = await memberCapabilities(0, nsId, account);

      // ── Promote ──────────────────────────────────────────────────────────
      await roleSelect.selectOption('Admin');

      const promoted = await waitForRole(0, nsId, account, 'Admin', 30_000);
      expect(
        promoted?.toLowerCase(),
        `node 0 never recorded the promotion (role is "${promoted}")`,
      ).toBe('admin');

      // The invariant: promoting moves the ROLE and must not touch the mask.
      const overrideAfter = await memberCapabilities(0, nsId, account);
      expect(
        overrideAfter,
        'promoting wrote a capability override; it must set the role only',
      ).toBe(overrideBefore);

      // The grant has to reach the promoted person's OWN node, or it confers
      // nothing to them however it looks in the promoter's browser.
      const onJoinerNode = await waitForRole(1, nsId, account, 'Admin', 45_000);
      expect(
        onJoinerNode?.toLowerCase(),
        `the promotion never reached node 1 (role there is "${onJoinerNode}")`,
      ).toBe('admin');

      // ── Demote ───────────────────────────────────────────────────────────
      await expect(roleSelect).toHaveValue('Admin', { timeout: 30_000 });
      await roleSelect.selectOption('Member');

      const demoted = await waitForRole(0, nsId, account, 'Member', 30_000);
      expect(
        demoted?.toLowerCase(),
        `node 0 never recorded the demotion (role is "${demoted}")`,
      ).toBe('member');

      // Still untouched after the round trip — an ex-admin must not keep an
      // admin's bits via a mask the app wrote on the way in.
      expect(await memberCapabilities(0, nsId, account)).toBe(overrideBefore);
    } finally {
      await clearAuth(pageA).catch(() => {});
      await clearAuth(pageB).catch(() => {});
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('nobody can change their own role', async ({ page }) => {
    // The last admin demoting themselves locks every member out of the
    // workspace permanently: the person who could grant the role back no longer
    // exists. So your own row is always a badge, never a control.
    //
    // Asserted per-ROW rather than by counting selects: this spec file's
    // workspace is shared with the test above, which joins a second node into
    // it, so the number of rows (and of selects) depends on test order. What
    // must hold regardless is that the row marked "You" carries no control.
    await loginViaHash(page, 0);
    try {
      await createWorkspace(page);
      await page.getByTestId('nav-members').click();

      const ownRow = page.locator('[data-testid="member-row"]', {
        has: page.locator('.you-badge'),
      });
      await expect(ownRow).toHaveCount(1, { timeout: 30_000 });
      await expect(ownRow.getByTestId('member-role-badge')).toBeVisible();
      await expect(ownRow.getByTestId('member-role-select')).toHaveCount(0);
    } finally {
      await clearAuth(page).catch(() => {});
    }
  });
});
