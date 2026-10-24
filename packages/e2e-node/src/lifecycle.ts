import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { appOrigin, fromNode } from "./appOrigin";
import { loginWithModal } from "./auth";
import { adminApi, freshRig, readRigState, restartNode, type RigNode, type RigState } from "./rig";
import {
  acceptInvitePrompt,
  installDesktopBridge,
  loginFromInviteLanding,
  openInviteLink,
  type InviteRoute,
} from "./invite";
import { TrafficLog } from "./traffic";

export interface Actor {
  name: "alice" | "bob";
  page: Page;
  node: RigNode;
  run: string;
}

export interface Feature {
  name: string;
  do(actor: Actor): Promise<void>;
  seen(actor: Actor, by: Actor): Promise<void>;
  oneWay?: boolean;
}

export interface AppDriver {
  app: string;
  open?(actor: Actor): Promise<void>;
  login?(actor: Actor): Promise<void>;
  createNamespace(actor: Actor, name: string): Promise<void>;
  createSpace?(actor: Actor, name: string): Promise<void>;
  openSpace?(actor: Actor, name: string): Promise<void>;
  /** Mint an invitation and return the link as the inviter copies it. */
  invite(actor: Actor): Promise<string>;
  /** Anything the app needs before a link is opened in it, e.g. a player name. */
  beforeJoin?(actor: Actor): Promise<void>;
  /**
   * The link has been opened and the invitation prompt accepted; wait until the actor is
   * inside what they joined. The journey opens the link itself: no driver pastes one.
   */
  joined(actor: Actor): Promise<void>;
  afterReload?(actor: Actor): Promise<void>;
  /**
   * `false` for an app without mero-react's `InvitationGate` (no `MeroProvider`, or its own
   * login), which skips opening the link logged out. Every other app shows the screen.
   */
  inviteLanding?: false;
  features: Feature[];
  permissions?: string[];
}

export interface NamespaceRow {
  id: string;
  name?: string;
}

export async function listNamespaces(node: RigNode): Promise<NamespaceRow[]> {
  const body = await adminApi<unknown>(node, "GET", "/admin-api/namespaces");
  const rows = Array.isArray(body)
    ? body
    : ((body as { namespaces?: unknown[] }).namespaces ?? (body as { items?: unknown[] }).items ?? []);
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: String(r["namespaceId"] ?? r["namespace_id"] ?? r["id"] ?? r["groupId"] ?? ""),
    name: (r["name"] ?? r["alias"]) as string | undefined,
  }));
}

export function rigDataDir(): string {
  const dir = process.env["JOURNEY_DATA_DIR"];
  if (!dir) throw new Error("JOURNEY_DATA_DIR is not set; run the journey through its playwright.journey.config.ts");
  return dir;
}

export function rig(): RigState {
  return readRigState(rigDataDir());
}

export async function openActor(
  browser: Browser,
  name: Actor["name"],
  node: RigNode,
  run: string,
  traffic: TrafficLog,
  nodeUrls: string[],
  permissions: string[] = [],
  desktop = false,
): Promise<{ actor: Actor; context: BrowserContext }> {
  const record = process.env["JOURNEY_VIDEO"] === "1";
  const origin = fromNode() ? appOrigin(node) : undefined;
  const context = await browser.newContext({
    ...(origin ? { baseURL: origin } : {}),
    permissions: ["clipboard-read", "clipboard-write", ...permissions],
    // Opt-in: a context made by hand is outside Playwright's `use.video`, so a
    // journey records only when asked, one file per actor.
    ...(record ? { recordVideo: { dir: path.join(rigDataDir(), "videos"), size: { width: 960, height: 540 } } } : {}),
  });
  const page = await context.newPage();
  if (record) recordings.set(context, { name, page, startedAt: Date.now() });
  if (desktop) await installDesktopBridge(page);
  await traffic.watch(page, name, origin ? [...nodeUrls, origin] : nodeUrls);
  return { actor: { name, page, node, run }, context };
}

const recordings = new WeakMap<BrowserContext, { name: Actor["name"]; page: Page; startedAt: number }>();

/**
 * Close the actors' contexts. With JOURNEY_VIDEO=1, attach each actor's
 * recording as `<name>.webm`, plus `video-timing` — when each recording began,
 * in epoch ms — so the two can be laid side by side on one clock.
 */
export async function closeActors(contexts: BrowserContext[], testInfo: TestInfo): Promise<void> {
  const timing: Record<string, number> = {};
  for (const context of contexts) {
    const rec = recordings.get(context);
    await context.close().catch(() => undefined);
    const video = rec?.page.video();
    if (!rec || !video) continue;
    const out = testInfo.outputPath(`${rec.name}.webm`);
    try {
      await video.saveAs(out);
      await testInfo.attach(rec.name, { path: out, contentType: "video/webm" });
      timing[rec.name] = rec.startedAt;
    } catch (e) {
      console.warn(`[journey] could not save ${rec.name}'s video:`, e);
    }
  }
  if (Object.keys(timing).length) {
    await testInfo.attach("video-timing", { body: JSON.stringify(timing), contentType: "application/json" });
  }
}

export async function defaultLogin(actor: Actor): Promise<void> {
  const connect = actor.page.getByRole("button", { name: /^(connect|log ?in|sign ?in|get started)/i }).first();
  await expect(connect).toBeVisible({ timeout: 30_000 });
  await connect.click();
  await loginWithModal(actor.page, actor.node.url);
}

export async function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

export function extractInvitation(text: string): string {
  const url = text.match(/https?:\/\/\S+/)?.[0];
  return (url ?? text).trim();
}

/** Every app shares links in one shape; anything else cannot be opened by the links page. */
export const INVITE_LINK = /^https:\/\/links\.calimero\.network\/[^/?#]+\/join\?(.*&)?invitation=[^&#]+/;

/** Open `link` by `route`, accept the prompt, and wait for the driver to see the actor in. */
export async function joinByLink(driver: AppDriver, actor: Actor, link: string, route: InviteRoute): Promise<void> {
  if (driver.beforeJoin) await driver.beforeJoin(actor);
  await openInviteLink(actor.page, link, route);
  await acceptInvitePrompt(actor.page);
  await driver.joined(actor);
}

/**
 * Node 2 holds at least one namespace alice created in this test.
 *
 * Not all of them: an app can create more than the one it invites to — a
 * personal namespace made on first login, say — and on fresh nodes that one
 * can land just after the "before" snapshot. Bob is never invited to it.
 */
async function expectJoinedOneOf(node: RigNode, created: NamespaceRow[]): Promise<void> {
  const wanted = created.map((ns) => ns.id);
  expect(wanted.length, "alice's node lists a namespace this test created").toBeGreaterThan(0);
  await expect
    .poll(async () => (await listNamespaces(node)).some((ns) => wanted.includes(ns.id)), {
      message: `node 2 has joined one of alice's new namespaces (${wanted.map((id) => id.slice(0, 8)).join(", ")})`,
      timeout: 60_000,
    })
    .toBe(true);
}

/**
 * Alice's node lists bob as a member of the namespace he joined.
 *
 * Bob's own node holding the namespace (`expectJoinedOneOf`) is only his
 * side: his join is a signed op that has to reach alice's node too, or she
 * never sees him, his writes are not hers, and he gets none of her state. A
 * join that landed only on the joiner's node looked joined and showed no data.
 */
async function expectInviterSeesJoiner(
  inviter: RigNode,
  joiner: RigNode,
  created: NamespaceRow[],
): Promise<void> {
  const held = new Set((await listNamespaces(joiner)).map((ns) => ns.id));
  const joined = created.find((ns) => held.has(ns.id));
  expect(joined, "node 2 holds one of alice's namespaces").toBeTruthy();
  await expect
    .poll(
      async () => {
        const body = await adminApi<unknown>(inviter, "GET", `/admin-api/groups/${joined!.id}/members`);
        const members = Array.isArray(body)
          ? body
          : ((body as { members?: unknown[] }).members ?? []);
        return members.length;
      },
      {
        message: `alice's node lists bob as a member of ${joined!.id.slice(0, 8)} (two members)`,
        timeout: 90_000,
      },
    )
    .toBeGreaterThanOrEqual(2);
}

export function defineLifecycle(driver: AppDriver): void {
  test.describe.configure({ mode: "serial" });

  test(`${driver.app}: fresh nodes → login → namespace → invite → second node → every feature`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(Number(process.env["JOURNEY_TIMEOUT_MS"]) || 15 * 60_000);
    const state = rig();
    const [n1, n2] = state.nodes;
    if (!n1 || !n2) throw new Error(`the rig has ${state.nodes.length} node(s); the lifecycle needs 2`);
    const run = `j${Date.now().toString(36)}`;
    const traffic = new TrafficLog();
    const urls = state.nodes.map((n) => n.url);
    const opened: BrowserContext[] = [];

    try {
      const a = await openActor(browser, "alice", n1, run, traffic, urls, driver.permissions);
      opened.push(a.context);
      const alice = a.actor;

      await test.step("alice opens the app and logs in through her node", async () => {
        if (driver.open) await driver.open(alice);
        else await alice.page.goto("/");
        await (driver.login ?? defaultLogin)(alice);
      });

      const before = await listNamespaces(n1);
      const nsName = `${driver.app}-${run}`;
      await test.step("alice creates a namespace by clicking", async () => {
        await driver.createNamespace(alice, nsName);
        await expect
          .poll(async () => (await listNamespaces(n1)).length, {
            message: "node 1 lists a new namespace",
            timeout: 30_000,
          })
          .toBeGreaterThan(before.length);
      });
      const created = (await listNamespaces(n1)).filter((ns) => !before.some((b) => b.id === ns.id));

      if (driver.createSpace) {
        await test.step("alice creates the first space inside it", async () => {
          await driver.createSpace!(alice, `first-${run}`);
        });
      }

      let link = "";
      await test.step("alice creates an invitation", async () => {
        link = await driver.invite(alice);
        expect(link, "the invitation is a shareable link").toMatch(INVITE_LINK);
      });

      if (driver.inviteLanding !== false) {
        // A browser of its own: bob then joins by the regular path below, so the app's
        // own login and setup run for him as for alice, from a clean session.
        const cold = await openActor(browser, "bob", n2, run, traffic, urls, driver.permissions);
        opened.push(cold.context);
        await test.step("bob opens the link logged out, is told he is invited, and logs in from there", async () => {
          await openInviteLink(cold.actor.page, link, "url");
          await loginFromInviteLanding(cold.actor.page, n2.url);
          await cold.actor.page.getByTestId("invite-decline").click();
          await expect(cold.actor.page.getByTestId("invite-prompt")).toHaveCount(0);
        });
      }

      const b = await openActor(browser, "bob", n2, run, traffic, urls, driver.permissions);
      opened.push(b.context);
      const bob = b.actor;

      await test.step("bob opens the app on node 2 and logs in", async () => {
        if (driver.open) await driver.open(bob);
        else await bob.page.goto("/");
        await (driver.login ?? defaultLogin)(bob);
      });

      await test.step("bob opens the invitation link", async () => {
        await joinByLink(driver, bob, link, "url");
        await expectJoinedOneOf(n2, created);
        await expectInviterSeesJoiner(n1, n2, created);
        if (driver.openSpace && driver.createSpace) await driver.openSpace(bob, `first-${run}`);
      });

      for (const feature of driver.features) {
        await test.step(`feature: ${feature.name} (alice → bob)`, async () => {
          await feature.do(alice);
          await feature.seen(bob, alice);
        });
        if (!feature.oneWay) {
          await test.step(`feature: ${feature.name} (bob → alice)`, async () => {
            await feature.do(bob);
            await feature.seen(alice, bob);
          });
        }
      }

      const first = driver.features[0];
      if (first) {
        await test.step("alice reloads and still sees the data", async () => {
          await alice.page.reload();
          if (driver.afterReload) await driver.afterReload(alice);
          await first.seen(alice, alice);
        });
      }

      if (first && fromNode()) {
        await test.step("alice opens a deep link under the app's path and the app still boots", async () => {
          // The node answers an unknown client route with the entry page, so its relative assets resolve below the link.
          expect(new URL(alice.page.url()).origin, "the page is the one the node serves").toBe(appOrigin(n1));
          await alice.page.goto(new URL("deep/link", alice.page.url()).href);
          if (driver.afterReload) await driver.afterReload(alice);
          await first.seen(alice, alice);
        });
      }

      if (driver.createSpace && driver.openSpace) {
        await test.step("a space created after bob joined reaches bob", async () => {
          await driver.createSpace!(alice, `later-${run}`);
          await driver.openSpace!(bob, `later-${run}`);
        });
      }

      if (first) {
        await test.step("node 1 restarts; alice's open app catches up afterwards", async () => {
          await restartNode(state, 0);
          await first.do(bob);
          await first.seen(alice, bob);
        });
      }

      if (driver.createSpace && driver.openSpace && process.env["JOURNEY_SPACE_AFTER_RESTART"] === "1") {
        await test.step("a space created after node 1 restarted reaches bob", async () => {
          await driver.createSpace!(alice, `restart-${run}`);
          await driver.openSpace!(bob, `restart-${run}`);
        });
      }

      expect(traffic.pageErrors, "uncaught page errors").toEqual([]);
    } finally {
      await traffic.attach(testInfo);
      await closeActors(opened, testInfo);
    }
  });

  test(`${driver.app}: an invitation opened in the desktop app joins without a reload`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(Number(process.env["JOURNEY_TIMEOUT_MS"]) || 10 * 60_000);
    // Fresh nodes, so this test never depends on what the lifecycle left behind:
    // an app with one namespace per node would otherwise hand alice back the old
    // one, and bob would already be in it.
    const state = await freshRig(rig(), "lifecycle");
    const [n1, n2] = state.nodes;
    if (!n1 || !n2) throw new Error(`the rig has ${state.nodes.length} node(s); the journey needs 2`);
    const run = `d${Date.now().toString(36)}`;
    const traffic = new TrafficLog();
    const urls = state.nodes.map((n) => n.url);
    const opened: BrowserContext[] = [];

    try {
      const a = await openActor(browser, "alice", n1, run, traffic, urls, driver.permissions);
      opened.push(a.context);
      const alice = a.actor;
      // Bob's app runs inside the launcher: the bridge is there before the app boots.
      const b = await openActor(browser, "bob", n2, run, traffic, urls, driver.permissions, true);
      opened.push(b.context);
      const bob = b.actor;

      await test.step("both open the app and log in", async () => {
        for (const actor of [alice, bob]) {
          if (driver.open) await driver.open(actor);
          else await actor.page.goto("/");
          await (driver.login ?? defaultLogin)(actor);
        }
      });

      const before = await listNamespaces(n1);
      let link = "";
      await test.step("alice creates a namespace and an invitation", async () => {
        await driver.createNamespace(alice, `${driver.app}-${run}`);
        await expect
          .poll(async () => (await listNamespaces(n1)).length, { timeout: 30_000 })
          .toBeGreaterThan(before.length);
        if (driver.createSpace) await driver.createSpace(alice, `first-${run}`);
        link = await driver.invite(alice);
        expect(link, "the invitation is a shareable link").toMatch(INVITE_LINK);
      });
      const created = (await listNamespaces(n1)).filter((ns) => !before.some((x) => x.id === ns.id));

      await test.step("a link for another app is not this app's to join", async () => {
        const foreign = link.replace(/(links\.calimero\.network\/)[^/?#]+/, "$1com.calimero.not-this-app");
        await openInviteLink(bob.page, foreign, "desktop");
        await bob.page.waitForTimeout(3_000);
        await expect(bob.page.getByTestId("invite-accept")).toHaveCount(0);
      });

      await test.step("the launcher hands bob's open app the link, and he joins", async () => {
        await joinByLink(driver, bob, link, "desktop");
        await expectJoinedOneOf(n2, created);
        await expectInviterSeesJoiner(n1, n2, created);
      });

      const first = driver.features[0];
      if (first) {
        await test.step(`feature: ${first.name} reaches bob`, async () => {
          if (driver.openSpace && driver.createSpace) await driver.openSpace(bob, `first-${run}`);
          await first.do(alice);
          await first.seen(bob, alice);
        });
      }

      expect(traffic.pageErrors, "uncaught page errors").toEqual([]);
    } finally {
      await traffic.attach(testInfo);
      await closeActors(opened, testInfo);
    }
  });
}
