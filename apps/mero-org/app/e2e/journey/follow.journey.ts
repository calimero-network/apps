import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { MeroJs } from "@calimero-network/mero-js";
import { rig, waitFor, type RigNode } from "@calimero-apps/e2e-node/journey";
import { MeroOrgClient } from "../../src/generated/MeroOrgClient";

/**
 * Three nodes, and app access without a second invitation:
 *
 *   the founder founds the org on node 1 and invites Ana (node 2) and Bob
 *   (node 3) → both claim → the founder puts them in Engineering, registers
 *   an app namespace and grants Engineering access → the reconciler adds both
 *   accounts straight to that namespace's root and its mirrored subgroup →
 *   each member presses Join on Me, which follows the namespace from the
 *   founder's node → their nodes hold it, and Ana's write there reaches the
 *   founder's node, which proves her device link is published.
 *
 * Needs a merod with namespace follow (core#4563): run with MEROD_BINARY. With
 * JOURNEY_ADVERTISE_IP set to this host's LAN IP the nodes advertise addresses,
 * and each follow must name the founder's; without it they advertise none and
 * the follow finds the founder on the namespace topic.
 */

const CREDS = { username: "admin", password: "adminadmin" };

interface Session { node: RigNode; mero: MeroJs; tokens: { access_token: string; refresh_token: string } }

async function session(node: RigNode): Promise<Session> {
  const mero = new MeroJs({ baseUrl: node.url, credentials: CREDS });
  const tokens = await mero.authenticate();
  return { node, mero, tokens };
}

async function open(browser: Browser, s: Session, errors: string[]): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(`${s.node.name}: ${e.message}`));
  await page.addInitScript(([key, url]) => window.localStorage.setItem(key, url), ["mero:node_url", s.node.url] as const);
  const params = new URLSearchParams({
    access_token: s.tokens.access_token,
    refresh_token: s.tokens.refresh_token,
    node_url: s.node.url,
    application_id: s.node.applicationId,
  });
  await page.goto(`/#${params.toString()}`);
  return page;
}

async function claimFromInvite(page: Page, invite: string, name: string): Promise<void> {
  const url = new URL(invite);
  await page.goto(`${url.pathname}${url.hash}`);
  await expect(page.getByRole("heading", { name: "Welcome. Who are you?" })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Name", { exact: true }).fill(name);
  await page.getByLabel("Handle", { exact: true }).fill(name.toLowerCase());
  await page.getByRole("button", { name: "Join", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Me" })).toBeVisible({ timeout: 120_000 });
}

async function accountOf(s: Session): Promise<string> {
  return (await s.mero.admin.getNodeIdentity()).accountId;
}

test("members added to an app namespace join it with a follow, no second invitation", async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const nodes = rig().nodes;
  expect(nodes).toHaveLength(3);
  const [founder, ana, bob] = await Promise.all(nodes.map(session)) as [Session, Session, Session];
  const errors: string[] = [];

  // The founder founds the org.
  const fp = await open(browser, founder, errors);
  await fp.getByRole("button", { name: "Create org" }).click();
  await expect(fp.getByRole("heading", { name: "Welcome. Who are you?" })).toBeVisible({ timeout: 60_000 });
  await fp.getByLabel("Name", { exact: true }).fill("Founder");
  await fp.getByLabel("Handle", { exact: true }).fill("founder");
  await fp.getByRole("button", { name: "Join", exact: true }).click();
  const nav = fp.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByRole("link", { name: "People" })).toBeVisible({ timeout: 60_000 });

  // One org invitation link each: the only invitation anyone receives.
  const invite = async () => {
    await nav.getByRole("link", { name: "People" }).click();
    await fp.getByRole("button", { name: "Invite" }).click();
    const field = fp.getByTestId("invite-link");
    await expect(field).not.toHaveValue("", { timeout: 30_000 });
    const value = await field.inputValue();
    await fp.keyboard.press("Escape");
    return value;
  };
  const ap = await open(browser, ana, errors);
  await claimFromInvite(ap, await invite(), "Ana");
  const bp = await open(browser, bob, errors);
  await claimFromInvite(bp, await invite(), "Bob");

  // Both reach the founder's node; the founder puts them in Engineering.
  await nav.getByRole("link", { name: "Groups" }).click();
  await fp.getByRole("button", { name: "New group" }).click();
  const newGroup = fp.getByRole("dialog", { name: "New group" });
  await newGroup.getByLabel("Name", { exact: true }).fill("Engineering");
  await newGroup.getByRole("button", { name: "Create" }).click();
  const eng = fp.getByRole("article", { name: "Engineering" });
  await expect(eng).toBeVisible();
  for (const name of ["Ana", "Bob"]) {
    await nav.getByRole("link", { name: "People" }).click();
    await expect(fp.getByRole("link", { name, exact: true })).toBeVisible({ timeout: 120_000 });
    await fp.getByRole("link", { name, exact: true }).click();
    const tick = fp.getByRole("checkbox", { name: "Engineering" });
    await tick.click();
    await expect(tick).toBeChecked();
  }

  // An app namespace the founder administers, with a context to read and write.
  const drive = await founder.mero.admin.createNamespace({ applicationId: founder.node.applicationId, name: "drive-standin" });
  const driveCtx = await founder.mero.admin.createContext({ applicationId: founder.node.applicationId, groupId: drive.namespaceId });
  await nav.getByRole("link", { name: "Apps" }).click();
  await fp.getByRole("button", { name: "Register", exact: true }).click();
  const register = fp.getByRole("dialog", { name: "Register an app" });
  await register.getByLabel("Namespace id").fill(drive.namespaceId);
  await register.getByLabel("Package").fill("com.calimero.mero-org");
  await register.getByLabel("Label").fill("Drive");
  await register.getByRole("button", { name: "Register app" }).click();
  await expect(fp.getByRole("row", { name: /Drive/ }).getByText("ready", { exact: true })).toBeVisible();

  // Grant Engineering the app; the reconciler adds both accounts at the root, no invitation.
  await nav.getByRole("link", { name: "Groups" }).click();
  const driveTick = eng.getByRole("checkbox", { name: "Drive", exact: true });
  await driveTick.click();
  await expect(driveTick).toBeChecked();
  await fp.getByRole("button", { name: "Run now" }).click();
  const [anaAccount, bobAccount] = await Promise.all([accountOf(ana), accountOf(bob)]);
  await waitFor("Ana and Bob added to Drive's namespace root", async () => {
    const { members } = await founder.mero.admin.listGroupMembers(drive.namespaceId);
    const ids = new Set(members.map((m) => m.identity));
    return ids.has(anaAccount) && ids.has(bobAccount);
  }, 120_000, 2_000);

  // Each member joins from Me, which follows the namespace from the founder's node.
  for (const [page, s] of [[ap, ana], [bp, bob]] as const) {
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Me" }).click();
    const row = page.locator("ul.waiting li").filter({ hasText: "Drive" });
    await expect(row).toBeVisible({ timeout: 120_000 });
    await row.getByRole("button", { name: "Join" }).click();
    await expect(row.getByText("joined", { exact: true })).toBeVisible({ timeout: 120_000 });
    await waitFor(`${s.node.name} holds Drive's namespace`, async () =>
      (await s.mero.admin.listNamespaces()).some((n) => n.namespaceId === drive.namespaceId), 30_000);
    if (process.env["JOURNEY_ADVERTISE_IP"]) {
      // The app row carried the founder's addresses, and the follow dialed them.
      const followLine = new RegExp(`Following namespace.*namespace_id=${drive.namespaceId} peers=[1-9]`);
      expect(readFileSync(s.node.log, "utf8").replace(/\x1b\[[0-9;]*m/g, "")).toMatch(followLine);
    }
  }

  // Ana's node runs Drive's context, and her write there reaches the founder's node.
  await waitFor("Ana's node joined Drive's context", async () =>
    (await ana.mero.admin.getContexts()).contexts.some((c) => c.id === driveCtx.contextId), 120_000, 2_000);
  await new MeroOrgClient(ana.mero, driveCtx.contextId).claimMembership({ display_name: "Ana in Drive", handle: "ana" });
  await waitFor("Ana's write reached the founder's node", async () => {
    const members = await new MeroOrgClient(founder.mero, driveCtx.contextId).members();
    return members.some((m) => m.account === anaAccount);
  }, 120_000, 2_000);

  // Nothing left waiting for either member.
  for (const page of [ap, bp]) {
    await page.reload();
    await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Me" }).click();
    await expect(page.getByText("Nothing waiting.")).toBeVisible({ timeout: 60_000 });
  }
  expect(errors).toEqual([]);
});
