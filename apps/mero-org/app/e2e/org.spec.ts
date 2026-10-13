import { expect, test, type Page } from "@playwright/test";
import { MeroJs } from "@calimero-network/mero-js";

import { readState } from "./global-setup";

/**
 * The admin's side of the org, through the UI, against a real node:
 *
 *   connect → found the org → a group → an invitation link → register an app
 *   → put yourself in the group → grant the group the app → Run now → the
 *   reconciler mirrors the group as a subgroup in the app's namespace → the
 *   activity chain verifies.
 *
 * A newcomer claiming on a second node, the admin rule refusing them, and the
 * org state converging across nodes are logic/workflows/org.yml's job.
 */

async function login(page: Page) {
  const s = readState();
  await page.addInitScript(
    ([key, url]) => window.localStorage.setItem(key, url),
    ["mero:node_url", s.nodeUrl] as const,
  );
  const params = new URLSearchParams({
    access_token: s.accessToken,
    refresh_token: s.refreshToken,
    node_url: s.nodeUrl,
    application_id: s.applicationId,
  });
  await page.goto(`/#${params.toString()}`);
}

/** The node, as a script calls it: the same admin session the browser holds. */
function node(): MeroJs {
  const s = readState();
  const mero = new MeroJs({ baseUrl: s.nodeUrl });
  mero.setTokenData({
    access_token: s.accessToken,
    refresh_token: s.refreshToken,
    expires_at: Date.now() + 60 * 60_000,
  });
  return mero;
}

test("found the org, invite, group, register an app and watch the reconciler place you", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await login(page);

  await page.getByRole("button", { name: "Create org" }).click();
  const nav = page.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByRole("link", { name: "People" })).toBeVisible({ timeout: 60_000 });

  const mero = node();
  const s = readState();
  const [orgNs] = await mero.admin.listNamespacesForApplication(s.applicationId);
  expect(orgNs).toBeDefined();
  const [orgCtx] = await mero.admin.listGroupContexts(orgNs!.namespaceId);
  expect(orgCtx).toBeDefined();

  // The founder is the org's admin but not yet one of its people: an invitee
  // claims on the join page, and the founder has no invitation to open. The
  // claim is the same contract call the join page makes, from the same session.
  await mero.rpc.execute({
    contextId: orgCtx!.contextId,
    method: "claim_membership",
    argsJson: { display_name: "Founder", handle: "founder" },
  });
  await page.reload();
  await expect(nav.getByRole("link", { name: "People" })).toBeVisible({ timeout: 60_000 });

  // A group.
  await nav.getByRole("link", { name: "Groups" }).click();
  await page.getByRole("button", { name: "New group" }).click();
  const newGroup = page.getByRole("dialog", { name: "New group" });
  await newGroup.getByLabel("Name", { exact: true }).fill("Engineering");
  await newGroup.getByRole("button", { name: "Create" }).click();
  const eng = page.getByRole("article", { name: "Engineering" });
  await expect(eng).toBeVisible();

  // An invitation link.
  await nav.getByRole("link", { name: "People" }).click();
  await page.getByRole("button", { name: "Invite" }).click();
  const invite = page.getByTestId("invite-link");
  await expect(invite).not.toHaveValue("", { timeout: 30_000 });
  expect(await invite.inputValue()).toContain("/join#ns=");

  // The founder joins Engineering, from their own row.
  // The ticks are controlled: they flip once the contract call lands, so a
  // click and a wait rather than `check()`, which wants the state at once.
  await page.getByRole("link", { name: "Founder", exact: true }).click();
  const inEng = page.getByRole("checkbox", { name: "Engineering" });
  await inEng.click();
  await expect(inEng).toBeChecked();

  // A second namespace of this same app stands in for "an app the org uses".
  // The node created it, so the founder is its Admin and it registers ready.
  const other = await mero.admin.createNamespace({ applicationId: s.applicationId, name: "drive-standin" });
  await nav.getByRole("link", { name: "Apps" }).click();
  await page.getByRole("button", { name: "Register", exact: true }).click();
  const register = page.getByRole("dialog", { name: "Register an app" });
  await register.getByLabel("Namespace id").fill(other.namespaceId);
  await register.getByLabel("Package").fill("com.calimero.mero-org");
  await register.getByLabel("Label").fill("Drive");
  await register.getByRole("button", { name: "Register app" }).click();
  const driveRow = page.getByRole("row", { name: /Drive/ });
  await expect(driveRow).toBeVisible();
  await expect(driveRow.getByText("ready", { exact: true })).toBeVisible();

  // Grant Engineering access. The founder is its only member, so the
  // reconciler creates the mirrored subgroup and places nobody else.
  await nav.getByRole("link", { name: "Groups" }).click();
  const driveTick = eng.getByRole("checkbox", { name: "Drive", exact: true });
  await driveTick.click();
  await expect(driveTick).toBeChecked();
  await page.getByRole("button", { name: "Run now" }).click();
  await expect
    .poll(
      async () => {
        const groups = await mero.admin.listNamespaceGroups(other.namespaceId);
        for (const g of groups) {
          const meta = await mero.admin.getGroupMetadata(g.groupId);
          if (meta?.data?.["org-group"]) return meta.name;
        }
        return null;
      },
      { timeout: 60_000 },
    )
    .toBe("Engineering");

  // The activity chain verifies.
  await nav.getByRole("link", { name: "Activity" }).click();
  await page.getByRole("button", { name: "Verify chain" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Chain intact" })).toBeVisible();

  expect(errors).toEqual([]);
});
