/**
 * Calimero Home end to end on `merod local`: an admin turns a legacy app into
 * an app team, invites someone to that app only, sees and revokes pending
 * invites, and removes a person from the org and so from every app.
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
  await page.getByTestId("signup-name").fill(name);
  await page.getByTestId("signup-passkey").click();
  // Two prompts on some setups: the second approves the sign-up.
  const approve = page.getByTestId("signup-approve");
  if (await approve.isVisible({ timeout: 2_000 }).catch(() => false)) await approve.click();
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
  // One to revoke…
  await admin.getByTestId(`invite-app-${kvPackage}`).check();
  await admin.getByTestId("invite-create").click();
  await expect(admin.getByTestId("invite-link")).toBeVisible();
  // …and one to send.
  await admin.getByTestId("invite-create").click();
  memberLink = (await admin.getByTestId("invite-link").locator("pre").textContent()) ?? "";
  expect(memberLink).toContain("invite=");
  // Both are listed by app (the seed's spent admin invite may be listed too).
  const pending = admin.getByTestId("pending-invites").locator("li", { hasText: "KV Store" });
  await expect(pending).toHaveCount(2);
  await pending.first().getByRole("button", { name: "Revoke" }).click();
  await expect(pending).toHaveCount(1);
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

test("People: removing someone from the org takes them out of every app", async () => {
  await admin.getByTestId("tab-people").click();
  const eve = admin.locator("tr", { hasText: "Eve" });
  await expect(eve).toBeVisible();
  await eve.getByRole("button", { name: "Remove from organization…" }).click();
  await expect(admin.getByTestId("remove-confirm")).toContainText("from every app in it");
  await admin.getByTestId("remove-confirm-yes").click();
  await expect(admin.getByTestId("people-notice")).toContainText("Eve was removed");
  await expect(admin.locator("tr", { hasText: "Eve" })).toHaveCount(0);
  await adminContext.close();
});
