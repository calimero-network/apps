/**
 * Mero Chat on its served origin, as on Calimero Cloud: node 1 serves Chat's
 * frontend from its bundle at `http://{label}.localhost:2501/`, so a passkey
 * session opened there is bound to Chat's package (`/auth/me`'s `app`). Such a
 * session may run Chat's own apps and teams; anything organization-wide goes
 * through the node's consent page, approved with the passkey on the node's
 * own origin.
 *
 * Ann makes a workspace and invites Bob, who joins: each through the consent
 * page. Then the channel flow a bound session must manage on Chat's own
 * teams: a private channel, a member added and removed, the channel deleted,
 * and Bob leaving.
 */
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";
import type { CalimeroSession } from "@calimero-network/mero-js";

import { LOCAL_NODES, localClient, signUp, type Person } from "../../packages/merod-local/src/cluster.ts";

import { browse, type Browsing } from "./browsing.ts";
import { SEED, type Seed } from "./global-setup.ts";
import { servedOrigin } from "./origins.ts";

const seed = (): Seed => JSON.parse(readFileSync(SEED, "utf8")) as Seed;

const CHAT = "com.calimero.chat";
const CHAT_ORIGIN = servedOrigin(CHAT);
const WORKSPACE = "Bound";
const CHANNEL = "secret";

/**
 * A browser for `person` on Chat's served origin: their passkey in it,
 * `window.confirm` answered yes (Chat asks before it sends anyone to the
 * consent page), and the invite link Chat copies kept where the spec reads it.
 */
async function chatBrowser(browser: Parameters<typeof browse>[0], person: Person): Promise<Browsing> {
  const b = await browse(browser, await person.passkey.toBrowser());
  b.page.on("dialog", (d) => void d.accept());
  await b.context.addInitScript(() => {
    const w = window as unknown as { __copied?: string };
    if (navigator.clipboard) {
      navigator.clipboard.writeText = async (text: string) => {
        w.__copied = text;
      };
    }
  });
  return b;
}

/** Signs in on the page showing Chat's landing page or its sign-in panel. */
async function signIn(page: Page): Promise<void> {
  const passkey = page.getByTestId("signin-passkey");
  const landing = page.getByRole("button", { name: "Sign in", exact: true }).first();
  await expect(passkey.or(landing).first()).toBeVisible({ timeout: 60_000 });
  if (!(await passkey.isVisible())) await landing.click();
  await passkey.click();
  await expect(passkey).toHaveCount(0);
}

/**
 * Approves on the node's consent page and waits to be back on Chat. The page
 * is opened under `localhost` rather than the node's `127.0.0.1` URL: its
 * passkey step-up names the cluster's rp-id, `localhost`, which a browser
 * refuses on an IP address (the setup trusts these origins).
 */
async function approveOnConsentPage(page: Page): Promise<void> {
  await page.waitForURL(/^http:\/\/(127\.0\.0\.1|localhost):\d+\/consent\/[^/?#]+/, { timeout: 60_000 });
  const url = new URL(page.url());
  if (url.hostname === "127.0.0.1") {
    url.hostname = "localhost";
    await page.goto(url.toString());
  }
  const approve = page.locator("#approve");
  await expect(approve).toBeVisible();
  await approve.click();
  await page.waitForURL((u) => u.origin === CHAT_ORIGIN, { timeout: 60_000 });
}

/** The package the page's session is bound to: `/auth/me`'s `app`, asked with that session. */
async function boundApp(page: Page): Promise<unknown> {
  const stored = () =>
    page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("calimero-session:")) return localStorage.getItem(key);
      }
      return null;
    });
  await expect.poll(stored, { message: "Chat stored no session" }).not.toBeNull();
  const client = localClient(LOCAL_NODES[0]!);
  client.useSession(JSON.parse((await stored())!) as CalimeroSession);
  return ((await client.auth.me()) as { app?: unknown }).app;
}

const general = (page: Page) => page.getByTestId("channel-item").filter({ hasText: "general" });
const channel = (page: Page) => page.getByTestId("channel-item").filter({ hasText: CHANNEL });

test.describe.configure({ mode: "serial" });

let ann: Person;
let bob: Person;
let annBrowser: Browsing;
let bobBrowser: Browsing;
let org = "";
let invite = "";

test.afterAll(async () => {
  await annBrowser?.context.close();
  await bobBrowser?.context.close();
});

test("1. Ann signs in on Chat's served origin, and the session is bound to Chat", async ({ browser }) => {
  // Chat installed on Ann's account (a package is installed per account);
  // the node then serves its frontend on the package's own origin.
  ann = await signUp("Ann", LOCAL_NODES[0]!);
  await ann.client.packages.upload({
    body: new Uint8Array(readFileSync(seed().chatMpk)),
    contentType: "application/octet-stream",
  });
  annBrowser = await chatBrowser(browser, ann);
  const page = annBrowser.page;

  await page.goto(`${CHAT_ORIGIN}/`);
  await signIn(page);
  expect(await boundApp(page)).toBe(CHAT);
});

test("2. Ann creates a workspace through the consent page and lands in #general", async () => {
  const page = annBrowser.page;
  await expect(page.getByText("You have no Mero Chat workspace yet")).toBeVisible();
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByPlaceholder("e.g. My Team").fill(WORKSPACE);
  await page.getByPlaceholder("e.g. Alice").fill("Ann");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await approveOnConsentPage(page);
  await expect(general(page)).toBeVisible({ timeout: 60_000 });

  const me = (await ann.client.auth.me()) as { orgs?: Array<{ orgId: string; name: string }> };
  org = me.orgs?.find((o) => o.name === WORKSPACE)?.orgId ?? "";
  expect(org, "the consent page made no organization").not.toBe("");
});

test("3. Ann invites through the consent page and gets a link", async () => {
  const page = annBrowser.page;
  await page.getByRole("button", { name: "Invite members" }).click();
  await approveOnConsentPage(page);
  await page.getByRole("button", { name: "Copy invite link" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? ""))
    .toContain("invite=");
  invite = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied ?? "");
  expect(new URL(invite).origin).toBe(CHAT_ORIGIN);
});

test("4. Bob opens the link, signs in and joins through the consent page", async ({ browser }) => {
  bob = await signUp("Bob", LOCAL_NODES[0]!);
  bobBrowser = await chatBrowser(browser, bob);
  const page = bobBrowser.page;

  await page.goto(invite);
  await signIn(page);
  expect(await boundApp(page)).toBe(CHAT);
  await page.getByRole("button", { name: "Join workspace" }).click();
  await approveOnConsentPage(page);

  // Back in Chat: a name for this workspace first, unless Chat has one.
  const name = page.getByPlaceholder("e.g. Alice");
  await expect(general(page).or(name).first()).toBeVisible({ timeout: 60_000 });
  if (await name.isVisible()) {
    await name.fill("Bob");
    await page.getByRole("button", { name: "Join chat" }).click();
  }
  await expect(general(page)).toBeVisible({ timeout: 60_000 });

  const me = (await bob.client.auth.me()) as { orgs?: Array<{ orgId: string }> };
  expect(me.orgs?.map((o) => o.orgId)).toContain(org);
});

test.fixme("5. Ann creates a private channel", async () => {
  // Needs channels as teams below Chat's app team (and the permission on Ann's app-team row).
  const page = annBrowser.page;
  await page.getByRole("button", { name: "Create channel" }).click();
  await page.getByPlaceholder("# channel name").fill(CHANNEL);
  await page.getByRole("button", { name: "Private", exact: true }).click();
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(channel(page)).toBeVisible({ timeout: 60_000 });
  await expect(channel(bobBrowser.page)).toHaveCount(0);
});

test.fixme("6. Ann adds Bob to the private channel", async () => {
  // Needs channel members as rows on the channel's team (apps.access with an account list is refused).
  const page = annBrowser.page;
  await channel(page).click();
  await page.getByTestId("channel-details").click();
  await page.getByText(/^Members \(\d+\)$/).click();
  await page.getByRole("button", { name: "Add member" }).click();
  await page.getByPlaceholder("Search by username...").fill("Bob");
  await page.getByText("Bob", { exact: true }).click();
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  await expect(page.getByText("Member added")).toBeVisible();
  await expect(channel(bobBrowser.page)).toBeVisible({ timeout: 120_000 });
});

test.fixme("7. Ann removes Bob from the private channel", async () => {
  // Needs channel members as rows on the channel's team (apps.access with an account list is refused).
  const page = annBrowser.page;
  await page.getByRole("button", { name: "Remove from channel" }).click();
  await expect(page.getByText("Member removed")).toBeVisible();
  await page.keyboard.press("Escape");
  await bobBrowser.page.reload();
  await expect(general(bobBrowser.page)).toBeVisible({ timeout: 60_000 });
  await expect(channel(bobBrowser.page)).toHaveCount(0);
});

test.fixme("8. Ann deletes the private channel", async () => {
  // Needs delete through the channel's team (apps.delete is refused).
  const page = annBrowser.page;
  await page.getByTestId("channel-details").click();
  await page.getByText("About", { exact: true }).click();
  await page.getByRole("button", { name: "Delete Channel" }).click();
  await expect(page.getByText(`Channel "${CHANNEL}" deleted`)).toBeVisible();
  await expect(channel(page)).toHaveCount(0);
});

test.fixme("9. Bob leaves the workspace", async () => {
  // Needs leaving the organization through the consent page (orgs.removeMember is refused).
  const page = bobBrowser.page;
  await page.getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Leave workspace" }).click();
  await page.getByRole("button", { name: "Confirm leave" }).click();
  await approveOnConsentPage(page);
  await expect(page.getByText("You have no Mero Chat workspace yet")).toBeVisible({ timeout: 60_000 });
  const me = (await bob.client.auth.me()) as { orgs?: Array<{ orgId: string }> };
  expect(me.orgs?.map((o) => o.orgId)).not.toContain(org);
});
