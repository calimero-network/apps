/**
 * Calimero Home end to end on `merod local`: an admin turns a legacy app into
 * an app team, invites someone to that app only, sees and revokes pending
 * invites, keeps apps apart (everyone is written into the app's list), takes
 * a person out of every app and gives them every app again, gives everyone
 * every app again, and removes a person from the org and so from every app.
 *
 * Needs core#4890 and #4891, first released in 1.0.0-rc.14 (see
 * playwright.config.ts): global-setup refuses an older merod with that reason.
 */
import { readFileSync } from "node:fs";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { SEED, type Seed } from "./global-setup.ts";

const seed = (): Seed => JSON.parse(readFileSync(SEED, "utf8")) as Seed;

/** Chromium's virtual authenticator: passkey ceremonies and step-ups answer without a prompt. */
async function withPasskey(context: BrowserContext, page: Page): Promise<void> {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

/** Signs up on the invitation page (the account and the join in one step). */
async function signUpFromInvite(page: Page, name: string): Promise<void> {
  // The first press asks for the (optional) name; the second creates the passkey.
  const create = page.getByTestId("signup-passkey");
  await create.click();
  await page.getByTestId("signup-name").fill(name);
  await create.click();
  // Two prompts: the page asks the second (the approval) at once, and only
  // when that one fails does it wait on an enabled "Approve" (while a prompt
  // is open the same test id is a disabled "waiting" button, and it leaves
  // the page once the sign-up is done). Done is when neither control is left.
  const approve = page.locator('[data-testid="signup-approve"]:enabled');
  const pending = page.locator('[data-testid="signup-approve"], [data-testid="signup-passkey"]');
  const failed = page.getByTestId("signin-error");
  await expect
    .poll(
      async () => {
        if (await failed.isVisible()) return `failed: ${await failed.innerText()}`;
        if (await approve.isVisible()) {
          await approve.click({ timeout: 5_000 }).catch(() => {});
          return "approving";
        }
        return (await pending.count()) === 0 ? "done" : "waiting";
      },
      { timeout: 90_000, message: "the sign-up never finished" },
    )
    .toBe("done");
}

test.describe.configure({ mode: "serial" });

let admin: Page;
let adminContext: BrowserContext;
let memberLink = "";

test("an admin joins from an invitation and lands in the org", async ({ browser }) => {
  const { org, adminInvite } = seed();
  adminContext = await browser.newContext();
  admin = await adminContext.newPage();
  await withPasskey(adminContext, admin);
  await admin.goto(`/?invite=${encodeURIComponent(adminInvite)}&org=${encodeURIComponent(org)}`);
  await signUpFromInvite(admin, "Dee");
  await expect(admin.getByTestId("org-mode")).toContainText("Admin");
  await expect(admin.getByRole("tab")).toHaveText(["Your apps", "People", "Invitations", "Admin"]);
});

test("Admin: a legacy app gets its own access list, everyone keeps it", async () => {
  const { kvPackage } = seed();
  await admin.getByTestId("tab-admin").click();
  await admin.getByTestId(`scope-${kvPackage}`).click();
  await expect(admin.getByTestId(`members-invite-${kvPackage}`)).toBeVisible();
  // A fresh open team (standalone): members may invite by default.
  await expect(admin.getByTestId(`members-invite-${kvPackage}`)).toBeChecked();
  await expect(admin.getByTestId("org-mode")).toContainText("Standalone");
});

test("Invitations: invite to the app, list it, revoke another", async () => {
  const { kvPackage } = seed();
  await admin.getByTestId("tab-invitations").click();
  // Listed by app (the seed's spent admin invite may be listed too).
  const pending = admin.getByTestId("pending-invites").locator("li", { hasText: "KV Store" });
  // One to revoke…
  await admin.getByTestId(`invite-app-${kvPackage}`).check();
  await admin.getByTestId("invite-create").click();
  await expect(admin.getByTestId("invite-link")).toBeVisible();
  await expect(pending).toHaveCount(1);
  // Told apart by key: the list is newest first, and two invites made in the
  // same second (createdAt is in seconds) can come in either order.
  const toRevoke = (await pending.getAttribute("data-testid"))!.replace(/^pending-/, "");
  // …and one to send.
  await admin.getByTestId("invite-create").click();
  await expect(pending).toHaveCount(2);
  memberLink = (await admin.getByTestId("invite-link").locator("pre").textContent()) ?? "";
  expect(memberLink).toContain("invite=");
  await admin.getByTestId(`revoke-${toRevoke}`).click();
  await expect(pending).toHaveCount(1);
  await expect(admin.getByTestId(`pending-${toRevoke}`)).toHaveCount(0);
});

test("the invited member gets that app only, and sees it in Your apps", async ({ browser }) => {
  const { kvPackage } = seed();
  const context = await browser.newContext();
  const page = await context.newPage();
  await withPasskey(context, page);
  const url = new URL(memberLink);
  await page.goto(`/${url.search}`);
  await signUpFromInvite(page, "Eve");
  await expect(page.getByTestId(`open-${kvPackage}`)).toBeVisible();
  await expect(page.getByRole("tab")).not.toContainText(["Admin"]);
  await context.close();
});

/** Eve's row in the People matrix, by her name in the row's header. */
const eveRow = () =>
  admin
    .getByTestId("people-table")
    .getByRole("row")
    .filter({ has: admin.getByRole("rowheader", { name: "Eve", exact: true }) });

test("Admin: keeping apps apart writes everyone who has an app into its list", async () => {
  await admin.getByTestId("tab-admin").click();
  await expect(admin.getByTestId("apart-state")).toHaveText("Everyone in the organization has every app");
  await expect(admin.getByTestId("apart-switch")).not.toBeChecked();
  await admin.getByTestId("apart-switch").click();
  await expect(admin.getByTestId("apart-confirm")).toContainText("Nobody is locked out");
  await admin.getByTestId("apart-confirm-yes").click();
  await expect(admin.getByTestId("org-mode")).toContainText("Shared");
  await expect(admin.getByTestId("apart-switch")).toBeChecked();
  // Eve joined while the app was open: she is in its list now.
  await admin.getByTestId("tab-people").click();
  await expect(eveRow().getByRole("combobox")).toHaveValue("member");
});

test("People: take someone out of every app, then give them every app", async () => {
  const eve = eveRow();
  await eve.getByRole("button", { name: "Remove from all apps…" }).click();
  await expect(admin.getByTestId("bulk-plan")).toContainText("Eve leaves: KV Store");
  await admin.getByTestId("bulk-confirm-yes").click();
  await expect(admin.getByTestId("bulk-done")).toHaveText("Taken out of KV Store.");
  await expect(eve.getByRole("combobox")).toHaveValue("none");
  await admin.getByTestId("bulk-panel").getByRole("button", { name: "Close" }).click();

  await eve.getByRole("button", { name: "Give all apps…" }).click();
  await expect(admin.getByTestId("bulk-plan")).toContainText("Eve joins, as a Member: KV Store");
  await admin.getByTestId("bulk-confirm-yes").click();
  await expect(admin.getByTestId("bulk-done")).toHaveText("Added to KV Store.");
  await expect(eve.getByRole("combobox")).toHaveValue("member");
  await admin.getByTestId("bulk-panel").getByRole("button", { name: "Close" }).click();
});

test("Admin: turning keep apps apart off gives everyone every app again", async () => {
  await admin.getByTestId("tab-admin").click();
  await admin.getByTestId("apart-switch").click();
  await expect(admin.getByTestId("apart-confirm")).toContainText("Give everyone every app?");
  await admin.getByTestId("apart-confirm-yes").click();
  await expect(admin.getByTestId("org-mode")).toContainText("Standalone");
  await expect(admin.getByTestId("apart-switch")).not.toBeChecked();
});

test("People: removing someone from the org takes them out of every app", async () => {
  await admin.getByTestId("tab-people").click();
  // By her name in the row's header: a row's text also says "Yes (everyone)".
  const eve = admin
    .getByTestId("people-table")
    .getByRole("row")
    .filter({ has: admin.getByRole("rowheader", { name: "Eve", exact: true }) });
  await expect(eve).toBeVisible();
  await eve.getByRole("button", { name: "Remove from organization…" }).click();
  await expect(admin.getByTestId("remove-confirm")).toContainText("from every app in it");
  await admin.getByTestId("remove-confirm-yes").click();
  await expect(admin.getByTestId("people-notice")).toContainText("Eve was removed");
  await expect(eve).toHaveCount(0);
  await adminContext.close();
});
