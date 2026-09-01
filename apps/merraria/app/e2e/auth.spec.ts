// The login → namespace → context path, end to end against a mocked node.
//
// landing.spec covers the happy walk (connect popup, world cards, create,
// invite). This file covers what happens around it: the web callback coming
// back without a node_url, resolving which installed application we are, the
// shape of what actually gets POSTed to the admin API, and every way the node
// can say no. These are the parts that have broken on real nodes before —
// a flat `POST /contexts`, a restricted subgroup, a baked application id.

import { expect, test } from "@playwright/test";
import {
  APP_ID,
  CapturedBodies,
  CTX_ID,
  freshState,
  GROUP_ID,
  mockAdmin,
  mockNode,
  NODE_URL,
  NS_ID,
  PACKAGE_NAME,
  seedAuthOnly,
  seedSession,
} from "./helpers";

/** the node's auth page, stubbed so the redirect lands somewhere real */
const stubAuthPage = (page: import("@playwright/test").Page) =>
  page.route(`${NODE_URL}/auth/login**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<h1>node auth</h1>" }),
  );

const storedSession = (page: import("@playwright/test").Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("mt-session") ?? "null"));

test.describe("web login", () => {
  test("a callback with no node_url still lands on the node we logged into", async ({ page }) => {
    // The node's callback hash does not always echo node_url back, so
    // beginWebLogin stashes it before redirecting. If that stash is ever lost
    // the player comes back authenticated to nobody, which reads as a hang.
    const state = freshState();
    await mockNode(page, state);
    await mockAdmin(page, [{ id: CTX_ID, applicationId: APP_ID, name: "e2e world" }], {});
    await stubAuthPage(page);

    await page.goto("/");
    await page.getByTestId("connect-open-btn").click();
    await page.getByTestId("node-url-input").fill(NODE_URL);
    await page.getByTestId("web-login-btn").click();
    await page.waitForURL(`${NODE_URL}/auth/login**`);

    // come back the way the node does: tokens + identity, NO node_url
    await page.goto(
      "/#access_token=cb-token&refresh_token=cb-refresh&application_id=" +
        APP_ID +
        "&context_identity=pk-me",
    );

    // we are on the picker for the right node — the world list actually loaded
    await expect(page.getByTestId("world-list")).toContainText("e2e world");
    expect((await storedSession(page))?.nodeUrl).toBe(NODE_URL);
    // and the hash is stripped, so a reload can't replay a spent token
    expect(new URL(page.url()).hash).toBe("");
  });

  test("a callback for a node we never started logging into is not a session", async ({ page }) => {
    await mockNode(page, freshState());
    await page.goto("/#access_token=stray-token&context_identity=pk-me");
    // nothing was stashed and the hash names no node: stay anonymous rather
    // than half-authenticate against whatever was last in storage
    await expect(page.getByTestId("connect-open-btn")).toBeVisible();
    await expect(page.getByTestId("world-list")).toHaveCount(0);
  });

  test("asks the node for the whole multi-context grant set", async ({ page }) => {
    // Missing any one of these turns into a 403 deep inside a later admin call
    // (the rc.9 login-loop shape), so pin the full list.
    let authUrl: string | null = null;
    await page.route(`${NODE_URL}/auth/login**`, (route) => {
      authUrl = route.request().url();
      return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>node auth</h1>" });
    });
    await page.goto("/");
    await page.getByTestId("connect-open-btn").click();
    await page.getByTestId("node-url-input").fill(NODE_URL);
    await page.getByTestId("web-login-btn").click();
    await page.waitForURL(`${NODE_URL}/auth/login**`);

    const params = new URL(authUrl!).searchParams;
    const granted = (params.get("permissions") ?? "").split(",");
    for (const p of [
      "context:create",
      "context:list",
      "context:execute",
      "application:list",
      "namespace",
      "group",
      "blob",
      "context:alias",
    ]) {
      expect(granted).toContain(p);
    }
    expect(params.get("package-name")).toBe(PACKAGE_NAME);
    // the callback must come back to us, without a stale hash riding along
    expect(params.get("callback-url")).not.toContain("#");
  });

  test("disconnecting drops the token bundle, not just the world", async ({ page }) => {
    await seedSession(page);
    await mockNode(page, freshState());
    await page.goto("/");
    await page.getByTestId("disconnect-btn").click();
    await expect(page.getByTestId("connect-open-btn")).toBeVisible();

    // leaving the tokens behind would silently re-authenticate the next visitor
    // on a shared machine
    expect(await page.evaluate(() => localStorage.getItem("mero-tokens"))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("mt-session"))).toBeNull();
  });
});

test.describe("resolving the installed application", () => {
  const createWorld = async (page: import("@playwright/test").Page, name = "e2e world") => {
    await page.goto("/");
    await page.getByTestId("create-world-open-btn").click();
    await page.getByTestId("world-name-input").fill(name);
    await page.getByTestId("create-world-btn").click();
  };

  test("picks our package out of several installed applications", async ({ page }) => {
    const captured: CapturedBodies = {};
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], captured, {
      applications: {
        data: {
          apps: [
            { id: "app-chat", package: "com.calimero.chat" },
            { id: APP_ID, package: PACKAGE_NAME },
            { id: "app-design", package: "com.calimero.design" },
          ],
        },
      },
    });
    await createWorld(page);
    await page.waitForFunction(() => "__mt" in window);
    // the world is created under OUR application, not whichever came first
    expect((captured.context as Record<string, unknown>).applicationId).toBe(APP_ID);
  });

  test("reads the package out of a manifest-bytes application record", async ({ page }) => {
    // some node versions serialize the manifest as metadata bytes rather than
    // a `package` field; the app is the same app either way
    const metadata = Array.from(
      new TextEncoder().encode(JSON.stringify({ package: PACKAGE_NAME, version: "0.1.1" })),
    );
    const captured: CapturedBodies = {};
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], captured, {
      applications: { data: { apps: [{ id: "app-other" }, { id: "app-bytes", metadata }] } },
    });
    await createWorld(page);
    await page.waitForFunction(() => "__mt" in window);
    expect((captured.context as Record<string, unknown>).applicationId).toBe("app-bytes");
  });

  test("falls back to the only application the node has", async ({ page }) => {
    const captured: CapturedBodies = {};
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], captured, {
      applications: { data: { apps: [{ id: "app-lonely", package: "com.example.sideload" }] } },
    });
    await createWorld(page);
    await page.waitForFunction(() => "__mt" in window);
    expect((captured.context as Record<string, unknown>).applicationId).toBe("app-lonely");
  });

  test("says the game isn't installed rather than creating a world under a stranger", async ({
    page,
  }) => {
    const captured: CapturedBodies = {};
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], captured, {
      applications: {
        data: {
          apps: [
            { id: "app-chat", package: "com.calimero.chat" },
            { id: "app-design", package: "com.calimero.design" },
          ],
        },
      },
    });
    await createWorld(page);
    await expect(page.getByTestId("create-error")).toContainText("not installed on this node");
    expect(captured.namespace).toBeUndefined(); // nothing was created at all
  });
});

test.describe("creating a world", () => {
  const openCreate = async (page: import("@playwright/test").Page) => {
    await page.goto("/");
    await page.getByTestId("create-world-open-btn").click();
  };

  test("a blank name becomes 'surface', and the name is remembered locally", async ({ page }) => {
    const captured: CapturedBodies = {};
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], captured);
    await openCreate(page);
    await page.getByTestId("world-name-input").fill("   ");
    await page.getByTestId("create-world-btn").click();
    await page.waitForFunction(() => "__mt" in window);

    expect(captured.namespace?.name).toBe("surface");
    expect(captured.group).toEqual({ groupName: "surface", visibility: "open" });
    // the node does not reliably echo context names back, so the picker leans
    // on this local record to show the world's name next time
    const names = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mero-world-names") ?? "{}"),
    );
    expect(names["ctx-created"]).toBe("surface");
  });

  test("a negative seed is normalized to a positive integer", async ({ page }) => {
    const captured: CapturedBodies = {};
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], captured);
    await openCreate(page);
    await page.getByTestId("world-name-input").fill("negative");
    await page.getByTestId("seed-input").fill("-42");
    await page.getByTestId("create-world-btn").click();
    await page.waitForFunction(() => "__mt" in window);

    const params = initParams(captured);
    expect(params.seed).toBe(42);
  });

  test("stamps the creation clock in unix SECONDS", async ({ page }) => {
    // The whole day/night cycle is derived from this one shared number; sending
    // millis here makes every world start in a distant, wrong time of day.
    const captured: CapturedBodies = {};
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], captured);
    await openCreate(page);
    await page.getByTestId("world-name-input").fill("clock");
    await page.getByTestId("create-world-btn").click();
    await page.waitForFunction(() => "__mt" in window);

    const now = Math.floor(Date.now() / 1000);
    const params = initParams(captured);
    expect(params.now).toBeGreaterThan(now - 300);
    expect(params.now).toBeLessThanOrEqual(now + 300);
  });

  test("a refused subgroup leaves the popup open, explained and retryable", async ({ page }) => {
    const captured: CapturedBodies = {};
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], captured);
    await page.route(`${NODE_URL}/admin-api/namespaces/${NS_ID}/groups`, (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ error: "subgroup name already taken" }),
      }),
    );
    await openCreate(page);
    await page.getByTestId("world-name-input").fill("doomed");
    await page.getByTestId("create-world-btn").click();

    // the node's own words, and a popup you can immediately try again in
    await expect(page.getByTestId("create-error")).toContainText("subgroup name already taken");
    await expect(page.getByTestId("create-modal")).toBeVisible();
    await expect(page.getByTestId("create-world-btn")).toBeEnabled();
    await expect(page.getByTestId("create-close")).toBeEnabled();
    expect(captured.context).toBeUndefined(); // no orphan context
  });

  test("a node that returns no namespace id fails instead of making a broken world", async ({
    page,
  }) => {
    const captured: CapturedBodies = {};
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], captured);
    await page.route(`${NODE_URL}/admin-api/namespaces`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) }),
    );
    await openCreate(page);
    await page.getByTestId("world-name-input").fill("headless");
    await page.getByTestId("create-world-btn").click();

    await expect(page.getByTestId("create-error")).toContainText("did not return a namespace id");
    // a context created outside a subgroup is exactly the 400 that started all
    // of this — we must not have reached that call
    expect(captured.group).toBeUndefined();
    expect(captured.context).toBeUndefined();
  });

  test("the created world is entered, and the picker remembers it next time", async ({ page }) => {
    const captured: CapturedBodies = {};
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], captured);
    await openCreate(page);
    await page.getByTestId("world-name-input").fill("persisted");
    await page.getByTestId("create-world-btn").click();
    await page.waitForFunction(() => "__mt" in window);

    const session = await storedSession(page);
    expect(session.contextId).toBe("ctx-created");
    expect(session.namespaceId).toBe(NS_ID);
    expect(session.groupId).toBe(GROUP_ID); // needed to mint invites later
    expect(session.worldName).toBe("persisted");

    // back out to the landing: the world is the "last played" card, by name
    await page.goto("/");
    await expect(page.getByTestId("world-card-current")).toContainText("persisted");
    await expect(page.getByTestId("world-card-current")).toContainText("last played");
  });
});

test.describe("when the node says no", () => {
  test("an unreachable node names the URL it tried", async ({ page }) => {
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], {});
    await page.route(`${NODE_URL}/admin-api/contexts`, (route) => route.abort());

    await page.goto("/");
    // not a bare TypeError — the URL to go check
    await expect(page.getByTestId("world-list")).toContainText("can't reach your node at");
    await expect(page.getByTestId("world-list")).toContainText(NODE_URL);
  });

  test("a rejected session says to log in again", async ({ page }) => {
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], {});
    await page.route(`${NODE_URL}/admin-api/contexts`, (route) =>
      route.fulfill({ status: 401, contentType: "text/plain", body: "Unauthorized" }),
    );

    await page.goto("/");
    await expect(page.getByTestId("world-list")).toContainText("disconnect and log in again");
  });

  test("a node internal error says to try again, not 'HTTP 500'", async ({ page }) => {
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], {});
    await page.route(`${NODE_URL}/admin-api/namespaces`, (route) =>
      route.fulfill({ status: 503, contentType: "text/plain", body: "upstream down" }),
    );

    await page.goto("/");
    await page.getByTestId("create-world-open-btn").click();
    await page.getByTestId("world-name-input").fill("unlucky");
    await page.getByTestId("create-world-btn").click();
    await expect(page.getByTestId("create-error")).toContainText("internal error");
    await expect(page.getByTestId("create-error")).toContainText("try again");
  });

  test("the node's own error text still wins over our translation", async ({ page }) => {
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], {});
    await page.route(`${NODE_URL}/admin-api/namespaces`, (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ data: { error: "application not found on this node" } }),
      }),
    );

    await page.goto("/");
    await page.getByTestId("create-world-open-btn").click();
    await page.getByTestId("world-name-input").fill("unlucky");
    await page.getByTestId("create-world-btn").click();
    await expect(page.getByTestId("create-error")).toContainText(
      "application not found on this node",
    );
  });
});

/** the JSON the contract is initialized with, decoded out of the POST body */
function initParams(captured: CapturedBodies): { name: string; seed: number; now: number } {
  const body = captured.context as { initializationParams: number[] };
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.initializationParams)));
}
