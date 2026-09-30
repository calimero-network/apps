import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { loginWithModal } from "./auth";
import { adminApi, readRigState, restartNode, type RigNode, type RigState } from "./rig";
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
  invite(actor: Actor): Promise<string>;
  acceptInvite(actor: Actor, link: string): Promise<void>;
  afterReload?(actor: Actor): Promise<void>;
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
): Promise<{ actor: Actor; context: BrowserContext }> {
  const context = await browser.newContext({
    permissions: ["clipboard-read", "clipboard-write", ...permissions],
  });
  const page = await context.newPage();
  traffic.watch(page, name, nodeUrls);
  return { actor: { name, page, node, run }, context };
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
        expect(link.length, "invitation text").toBeGreaterThan(20);
      });

      const b = await openActor(browser, "bob", n2, run, traffic, urls, driver.permissions);
      opened.push(b.context);
      const bob = b.actor;

      await test.step("bob opens the app on node 2 and logs in", async () => {
        if (driver.open) await driver.open(bob);
        else await bob.page.goto("/");
        await (driver.login ?? defaultLogin)(bob);
      });

      await test.step("bob redeems the invitation", async () => {
        await driver.acceptInvite(bob, link);
        await expect
          .poll(async () => (await listNamespaces(n2)).map((ns) => ns.id), {
            message: "node 2 has joined alice's namespace",
            timeout: 60_000,
          })
          .toEqual(expect.arrayContaining(created.map((ns) => ns.id)));
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

        await test.step("node 1 restarts; alice's open app catches up afterwards", async () => {
          await restartNode(state, 0);
          await first.do(bob);
          await first.seen(alice, bob);
        });
      }

      if (driver.createSpace && driver.openSpace) {
        await test.step("a space created after bob joined reaches bob", async () => {
          await driver.createSpace!(alice, `later-${run}`);
          await driver.openSpace!(bob, `later-${run}`);
        });
      }

      expect(traffic.pageErrors, "uncaught page errors").toEqual([]);
    } finally {
      await traffic.attach(testInfo);
      for (const c of opened) await c.close().catch(() => undefined);
    }
  });
}
