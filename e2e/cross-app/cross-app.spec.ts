/**
 * One organization, three apps, no state but core's: Alice makes a workspace
 * in Mero Chat on its own, then runs it from Calimero Home (adds KV Store,
 * invites Bob to both, takes him out of Chat only), and Chat reads the same
 * org Home changed. Each person has their own browser context and passkey.
 */
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { LOCAL_NODES, signUp, type Person } from "../../packages/merod-local/src/cluster.ts";

import { browse, type Browsing } from "./browsing.ts";
import { SEED, type Seed } from "./global-setup.ts";
import { ORIGINS } from "./origins.ts";

const seed = (): Seed => JSON.parse(readFileSync(SEED, "utf8")) as Seed;

const CHAT = "com.calimero.chat";
const KV = "com.calimero.kv-store";
const WORKSPACE = "Acme";
const STORE = "Notes";

/** Signs up on an invitation page (the account and the join in one step): Home's e2e's pattern. */
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

/** Signs in with the passkey the browser holds, on a page showing the shared sign-in panel. */
async function signInWithPasskey(page: Page): Promise<void> {
  await page.getByTestId("signin-passkey").click();
  await expect(page.getByTestId("signin-passkey")).toHaveCount(0);
}

/** Chat, signed in: its landing page's "Sign in" opens the passkey dialog. */
async function signInToChat(page: Page): Promise<void> {
  await page.goto(`${ORIGINS.chat}/`);
  await page.getByRole("button", { name: "Sign in", exact: true }).first().click();
  await signInWithPasskey(page);
}

/** Home, signed in, on `org`. */
async function openHome(page: Page, org?: string): Promise<void> {
  await page.goto(`${ORIGINS.home}/${org ? `?org=${encodeURIComponent(org)}` : ""}`);
  const signIn = page.getByTestId("signin-passkey");
  const picker = page.getByTestId("org-picker");
  await expect(signIn.or(picker)).toBeVisible();
  if (await signIn.isVisible()) await signInWithPasskey(page);
  await expect(picker).toBeVisible();
}

test.describe.configure({ mode: "serial" });

let alice: Person;
let aliceBrowser: Browsing;
let bob: Browsing;
let org = "";

test.afterAll(async () => {
  await aliceBrowser?.context.close();
  await bob?.context.close();
});

test("1. Alice makes a workspace in Chat, on its own", async ({ browser }) => {
  const { chatMpk, kvMpk } = seed();
  // Alice's account, with Chat and KV Store installed on it: a package is
  // installed per account, and merod local has no registry to install one
  // from by name, so the dev-signed packages are uploaded as her. Then her
  // browser gets the same passkey, and from there on only the browser uses it.
  alice = await signUp("Alice", LOCAL_NODES[0]!);
  for (const mpk of [chatMpk, kvMpk])
    await alice.client.packages.upload({
      body: new Uint8Array(readFileSync(mpk)),
      contentType: "application/octet-stream",
    });
  aliceBrowser = await browse(browser, await alice.passkey.toBrowser());
  const page = aliceBrowser.page;

  await signInToChat(page);
  await expect(page.getByText("You have no Mero Chat workspace yet")).toBeVisible();
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByPlaceholder("e.g. My Team").fill(WORKSPACE);
  await page.getByPlaceholder("e.g. Alice").fill("Alice");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  // In the workspace, with the #general channel Chat makes in it.
  await expect(page.getByTestId("channel-item").filter({ hasText: "general" })).toBeVisible();

  const me = (await alice.client.auth.me()) as { orgs?: Array<{ orgId: string; name: string }> };
  org = me.orgs?.find((o) => o.name === WORKSPACE)?.orgId ?? "";
  expect(org, "Chat made no organization").not.toBe("");
});

test("2. Home shows the org Chat made, with Chat for everyone in it", async () => {
  const page = aliceBrowser.page;
  await openHome(page, org);
  // Chat made its own open app team: the org is standalone, Chat everyone's.
  await expect(page.getByTestId("org-mode")).toContainText("Owner");
  await expect(page.getByTestId("org-mode")).toContainText("Standalone");
  await expect(page.getByTestId(`app-${CHAT}`)).toContainText("Mero Chat");
  await expect(page.getByTestId(`app-${CHAT}`)).toContainText("Everyone in the organization");
  await expect(page.getByTestId(`open-${CHAT}`)).toBeVisible();
});

test("3. Alice keeps apps apart, then adds KV Store from Home's Admin screen, for the people she adds", async () => {
  const page = aliceBrowser.page;
  await page.getByTestId("tab-admin").click();
  // Orgs are open by default: every app is everyone's. "Keep apps apart" closes
  // Chat's open team in one step, writing in everyone who has it (one passkey).
  await expect(page.getByTestId("apart-state")).toContainText("Everyone in the organization has every app");
  // A controlled switch: the click opens the confirm, the state changes once it is applied.
  await page.getByTestId("apart-switch").click();
  await expect(page.getByTestId("apart-keeps")).toContainText("Mero Chat");
  await page.getByTestId("apart-confirm-yes").click();
  await expect(page.getByTestId("apart-state")).toContainText("Each app lists who is in it");
  await expect(page.getByTestId("org-mode")).toContainText("Shared");
  // An app added now lists its own people: only Alice at first.
  await page.getByTestId("add-app-package").selectOption(KV);
  await expect(page.getByTestId("add-app-who")).toContainText("Only you have it at first");
  await page.getByTestId("add-app").click();
  await expect(page.getByTestId("app-added")).toContainText("KV Store is set up");
  await expect(page.getByTestId("org-mode")).toContainText("Shared");
  await expect(page.getByTestId(`admin-app-${CHAT}`)).toContainText("1 person");
  await expect(page.getByTestId(`admin-app-${KV}`)).toContainText("1 person");

  // Home never makes an app's instances: the app does, when it is opened. KV
  // Store's frontend makes a store only in an org of its own, so the store in
  // this org is made as Alice through mero-js (her session, no passkey), on
  // the app team Home just made, as an org app makes its instance.
  const teams = await alice.client.orgs.appTeamList({ org });
  const kvTeam = teams.appTeams.find((t) => t.package === KV)?.teamId;
  expect(kvTeam, "Home made no app team for KV Store").toBeTruthy();
  await alice.client.apps.create({ name: STORE, package: KV, org, access: { kind: "team", team: kvTeam! } });
});

test("4. Alice invites Bob to every app; he joins from Home and reaches the org in Chat and KV Store", async ({
  browser,
}) => {
  const page = aliceBrowser.page;
  await page.getByTestId("tab-invitations").click();
  await page.getByTestId(`invite-app-${CHAT}`).check();
  await page.getByTestId(`invite-app-${KV}`).check();
  await page.getByTestId("invite-create").click();
  await expect(page.getByTestId("invite-link")).toBeVisible();
  const link = (await page.getByTestId("invite-link").locator("pre").textContent()) ?? "";
  expect(link).toContain("invite=");

  // Home: Bob signs up from the link and lands in the org, with both apps.
  bob = await browse(browser);
  await bob.page.goto(`${ORIGINS.home}/${new URL(link).search}`);
  await signUpFromInvite(bob.page, "Bob");
  await expect(bob.page.getByTestId("org-mode")).toContainText("Member");
  await expect(bob.page.getByTestId(`open-${CHAT}`)).toBeVisible();
  await expect(bob.page.getByTestId(`open-${KV}`)).toBeVisible();

  // KV Store: the org's store is in his list.
  await bob.page.goto(`${ORIGINS.kv}/`);
  await signInWithPasskey(bob.page);
  await expect(bob.page.getByRole("row").filter({ hasText: STORE })).toContainText("shared");

  // Chat: the workspace is offered, and he is in it. His Chat stays open.
  await signInToChat(bob.page);
  await expect(bob.page.getByText("Select workspace")).toBeVisible();
  await expect(bob.page.getByRole("combobox")).toContainText(WORKSPACE);
  await bob.page.getByRole("button", { name: "Continue" }).click();
  await expect(bob.page.getByTestId("channel-item").filter({ hasText: "general" })).toBeVisible();

  // Alice's Chat lists him.
  await page.goto(`${ORIGINS.chat}/`);
  await page.getByTestId("workspace-admin-icon").click();
  const members = page.getByRole("dialog");
  await expect(members).toContainText("Members (2)");
  await expect(members.getByText("Bob", { exact: true })).toBeVisible();
});

test("5. People: Alice sets Bob to No for Chat; he loses Chat, keeps KV Store and the org", async () => {
  const page = aliceBrowser.page;
  await openHome(page, org);
  await page.getByTestId("tab-people").click();
  // By his name in the row's header.
  const row = page
    .getByTestId("people-table")
    .getByRole("row")
    .filter({ has: page.getByRole("rowheader", { name: "Bob", exact: true }) });
  const chatSeat = row.locator(`[data-testid^="seat-${CHAT}-"]`);
  await expect(chatSeat).toHaveValue("member");
  await chatSeat.selectOption("none");
  await expect(page.getByTestId("people-notice")).toContainText("Bob was taken out of Mero Chat");
  await expect(chatSeat).toHaveValue("none");
  await expect(row.locator(`[data-testid^="seat-${KV}-"]`)).toHaveValue("member");
  await expect(row.getByRole("button", { name: "Remove from organization…" })).toBeVisible();

  // Chat, still open, notices on its access poll and says he no longer has
  // Chat there, instead of an empty workspace; from there he picks another.
  await expect(bob.page.getByText(`You no longer have access to Chat in ${WORKSPACE}`)).toBeVisible({ timeout: 120_000 });
  await bob.page.getByRole("button", { name: "Choose another workspace" }).click();
  await expect(bob.page.getByText("You have no Mero Chat workspace yet")).toBeVisible({ timeout: 60_000 });

  // Still in the org in Home, with KV Store and without Chat.
  const home = await bob.context.newPage();
  await home.goto(`${ORIGINS.home}/?org=${encodeURIComponent(org)}`);
  await expect(home.getByTestId("org-mode")).toContainText("Member");
  await expect(home.getByTestId(`open-${KV}`)).toBeVisible();
  await expect(home.getByTestId(`app-${CHAT}`)).toHaveCount(0);

  // KV Store still lists the org's store.
  await home.goto(`${ORIGINS.kv}/`);
  await expect(home.getByRole("row").filter({ hasText: STORE })).toContainText("shared");
});

test("6. Back in Chat, Alice's member list no longer shows Bob", async () => {
  const page = aliceBrowser.page;
  await page.goto(`${ORIGINS.chat}/`);
  await expect(page.getByTestId("channel-item").filter({ hasText: "general" })).toBeVisible();
  await page.getByTestId("workspace-admin-icon").click();
  const members = page.getByRole("dialog");
  await expect(members).toContainText("Members (1)");
  await expect(members.getByText("Alice", { exact: true })).toBeVisible();
  await expect(members.getByText("Bob", { exact: true })).toHaveCount(0);
});
