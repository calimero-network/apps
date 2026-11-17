/**
 * Invites a second person to a workspace in Hyperfeed CRM on a real Calimero Cloud
 * cluster, through the shared invite and join dialogs.
 *
 * Both sessions are bound to the app's package, so core refuses them creating or
 * redeeming an invite directly: each dialog goes to the node's consent page in a
 * pop-up. The first browser context signs up, makes a workspace and creates the
 * invite; a second context with its own passkey opens the link and joins.
 *
 * Opt in with `INVITE_E2E=1` (it needs a production build made with
 * `VITE_CALIMERO_MIN_RELEASE`); `E2E_DIST_MERO_CRM` picks the build, `E2E_SHOTS` where screenshots go.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { appUrl } from "@calimero-apps/connect";
import { copyPasskey, serveLocally, virtualAuthenticator } from "./smoke-kit";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const SHOTS = process.env.E2E_SHOTS ?? join(REPO, "test-results", "invite");
const PACKAGE = "com.calimero.mero-crm";
const DIST = process.env.E2E_DIST_MERO_CRM ?? join(REPO, "apps", "mero-crm", "app", "dist");

type Authenticator = Awaited<ReturnType<typeof virtualAuthenticator>>;

/** Opens `url` as a new person: a fresh passkey and a passkey sign-up through the app's own page. */
async function signUp(page: Page, url: string): Promise<Authenticator> {
  const auth = await virtualAuthenticator(page);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const signUpButton = page.getByTestId("signup-passkey");
  const signIn = page.getByRole("button", { name: "Sign in", exact: true }).first();
  await expect(signUpButton.or(signIn).first()).toBeVisible({ timeout: 60_000 });
  if (!(await signUpButton.isVisible())) await signIn.click();
  await signUpButton.click();
  if (await page.getByTestId("signup-name").isVisible()) await signUpButton.click();
  const approve = page.locator('[data-testid="signup-approve"]:enabled');
  await expect(approve.or(page.getByRole("dialog")).or(page.getByTestId("ns-empty-state")).first()).toBeVisible({ timeout: 120_000 });
  if (await approve.isVisible()) await approve.click();
  return auth;
}

/** Clicks `button` in the open dialog and approves on the node's page in the pop-up it opens. */
async function approveOnNode(page: Page, button: string, auth: Authenticator) {
  const opened = page.context().waitForEvent("page");
  await page.getByRole("dialog").getByRole("button", { name: button, exact: true }).click();
  const popup = await opened;
  await copyPasskey(auth, popup);
  await popup.waitForLoadState("domcontentloaded");
  const approveButton = popup.getByRole("button", { name: /Approve/i });
  await expect(approveButton).toBeVisible({ timeout: 90_000 });
  const closed = popup.waitForEvent("close", { timeout: 120_000 });
  await approveButton.click();
  await closed;
}

async function servedContext(browser: import("@playwright/test").Browser, origin: string, version: string): Promise<BrowserContext> {
  const context = await browser.newContext();
  await serveLocally(context, origin, version, DIST);
  return context;
}

test.skip(process.env.INVITE_E2E !== "1", "set INVITE_E2E=1 to run against a cluster serving Hyperfeed CRM");

test("an invite made in the shared dialog is accepted in the shared dialog", async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true });
  expect(existsSync(join(DIST, "index.html")), `no production build at ${DIST}`).toBe(true);

  const origin = new URL(appUrl(PACKAGE)).origin;
  const manifest = (await (await (await browser.newContext()).request.get(`${origin}/.well-known/calimero.json`)).json()) as { versions: string[] };
  const version = manifest.versions[0]!;
  const base = `${origin}/${version}/`;

  const owner = await (await servedContext(browser, origin, version)).newPage();
  const ownerAuth = await signUp(owner, base);
  const workspace = `E2E invite ${Date.now().toString(36)}`;

  await test.step("the inviter makes a workspace", async () => {
    await expect(owner.getByTestId("ns-empty-state")).toBeVisible({ timeout: 120_000 });
    await owner.getByTestId("ns-create-btn").click();
    const dialog = owner.getByRole("dialog");
    await dialog.locator("input").nth(0).fill(workspace);
    await dialog.locator("input").nth(1).fill("Ada");
    await dialog.getByRole("button", { name: /Continue/ }).click();
    await expect(dialog.getByRole("button", { name: "Create workspace" })).toBeEnabled({ timeout: 90_000 });
    await approveOnNode(owner, "Create workspace", ownerAuth);
    await expect(owner.getByRole("dialog")).toHaveCount(0, { timeout: 120_000 });
  });

  let link = "";
  await test.step("the inviter creates a link in the shared dialog", async () => {
    await owner.goto(`${base}members`, { waitUntil: "domcontentloaded" });
    await owner.getByTestId("open-invite-btn").click();
    await expect(owner.getByRole("dialog").getByText("Default", { exact: true })).toBeVisible({ timeout: 60_000 });
    await owner.screenshot({ path: join(SHOTS, "invite-dialog.png") });
    await approveOnNode(owner, "Create invite", ownerAuth);
    const field = owner.getByRole("dialog").getByLabel("Invite link");
    await expect(field).toBeVisible({ timeout: 120_000 });
    link = await field.inputValue();
    expect(link).toContain("#invite=");
    await owner.screenshot({ path: join(SHOTS, "invite-ready.png") });
  });

  await test.step("a second person opens the link and joins in the shared dialog", async () => {
    const guest = await (await servedContext(browser, origin, version)).newPage();
    const guestAuth = await signUp(guest, link);
    const joinButton = guest.getByRole("dialog").getByRole("button", { name: "Join", exact: true });
    await expect(joinButton).toBeVisible({ timeout: 120_000 });
    await guest.screenshot({ path: join(SHOTS, "accept-dialog.png") });
    await approveOnNode(guest, "Join", guestAuth);
    await expect(guest.getByText(workspace).first()).toBeVisible({ timeout: 120_000 });
    await guest.screenshot({ path: join(SHOTS, "joined.png") });
  });
});
