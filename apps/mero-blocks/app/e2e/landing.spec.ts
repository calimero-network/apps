import { expect, test } from "@playwright/test";
import { encodeInvite } from "../src/net/inviteCodec";
import { CTX_ID, freshState, mockNode, NODE_URL, seedSession } from "./helpers";

test.describe("landing page", () => {
  test("shows the title screen: panorama, title, controls and the play card", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing")).toBeVisible();
    await expect(page.locator("h1")).toContainText("Mero Blocks");
    await expect(page.getByTestId("panorama")).toBeVisible();
    await expect(page.getByTestId("controls")).toContainText("WASD");
    await expect(page.getByTestId("offline-btn")).toBeVisible();
  });

  test("footer links out to the Calimero site, docs, and socials", async ({ page }) => {
    await page.goto("/");
    const social = page.getByTestId("social-links");
    for (const href of [
      "https://www.calimero.network/",
      "https://docs.calimero.network",
      "https://github.com/calimero-network",
      "https://github.com/calimero-network/mero-blocks",
      "https://x.com/CalimeroNetwork",
      "https://discord.gg/wZRC73DVpU",
      "https://www.linkedin.com/company/calimero-network/",
    ]) {
      await expect(social.locator(`a[href="${href}"]`)).toBeVisible();
    }
  });

  test("anonymous visitors get the web-login form, not the enter button", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("node-url-input")).toBeVisible();
    await expect(page.getByTestId("web-login-btn")).toBeVisible();
    await expect(page.getByTestId("connect-btn")).toHaveCount(0);
  });

  test("web login validates the node url", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("node-url-input").fill("not-a-url");
    await page.getByTestId("web-login-btn").click();
    await expect(page.getByTestId("login-error")).toContainText("node's URL");
  });

  test("web login redirects to the node's auth page with the right params", async ({ page }) => {
    let authUrl: string | null = null;
    await page.route(`${NODE_URL}/auth/login**`, (route) => {
      authUrl = route.request().url();
      return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>node auth</h1>" });
    });
    await page.goto("/");
    await page.getByTestId("node-url-input").fill(NODE_URL);
    await page.getByTestId("web-login-btn").click();
    await page.waitForURL(`${NODE_URL}/auth/login**`);

    const params = new URL(authUrl!).searchParams;
    expect(params.get("mode")).toBe("multi-context");
    expect(params.get("package-name")).toBe("com.calimero.meroblocks");
    expect(params.get("callback-url")).toContain("localhost");
    expect(params.get("permissions")).toContain("context:execute");
  });

  test("auto-discovers a running local node and connects in one click", async ({ page }) => {
    // pretend a node is alive on 2428; kill the other well-known ports so a
    // real dev node on this machine can't change the discovered order
    await page.route("http://localhost:2428/admin-api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { status: "alive" } }),
      }),
    );
    for (const port of [2429, 2528, 2529])
      await page.route(`http://localhost:${port}/admin-api/health`, (route) => route.abort());
    let authUrl: string | null = null;
    await page.route("http://localhost:2428/auth/login**", (route) => {
      authUrl = route.request().url();
      return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>node auth</h1>" });
    });

    await page.goto("/");
    await expect(page.getByTestId("discovered-nodes")).toContainText("http://localhost:2428");
    await page.getByTestId("discovered-node-0").click();
    await page.waitForURL("http://localhost:2428/auth/login**");

    const params = new URL(authUrl!).searchParams;
    expect(params.get("mode")).toBe("multi-context");
    expect(params.get("package-name")).toBe("com.calimero.meroblocks");
  });

  test("says so when no local node is running", async ({ page }) => {
    for (const port of [2428, 2429, 2528, 2529])
      await page.route(`http://localhost:${port}/admin-api/health`, (route) => route.abort());
    await page.goto("/");
    await expect(page.getByTestId("discovered-nodes")).toContainText("No local node found");
  });

  test("a connected session shows one-click enter + disconnect", async ({ page }) => {
    await seedSession(page);
    await mockNode(page, freshState());
    await page.goto("/");
    await expect(page.getByTestId("connect-btn")).toBeVisible();
    await page.getByTestId("disconnect-btn").click();
    // back to the anonymous card
    await expect(page.getByTestId("web-login-btn")).toBeVisible();
    await expect(page.getByTestId("connect-btn")).toHaveCount(0);
  });
});

test.describe("world picker (web auth, no context yet)", () => {
  const seedAuthOnly = (page: import("@playwright/test").Page) =>
    page.addInitScript(
      ({ nodeUrl }) => {
        localStorage.setItem(
          "mb-session",
          JSON.stringify({ nodeUrl, contextId: null, applicationId: null, executorPublicKey: null, devMode: false }),
        );
        localStorage.setItem(
          "mero-tokens",
          JSON.stringify({ access_token: "e2e-token", refresh_token: "r", expires_at: "" }),
        );
      },
      { nodeUrl: NODE_URL },
    );

  // NOTE: register AFTER mockNode — later routes win, and these must shadow
  // mockNode's generic admin-api handler for /applications and /contexts.
  const mockAdmin = async (
    page: import("@playwright/test").Page,
    contexts: { id: string; applicationId?: string }[],
    created: { current: unknown },
  ) => {
    // world creation now walks namespace → subgroup → context
    await page.route(`${NODE_URL}/admin-api/namespaces/for-application/*`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }),
    );
    await page.route(`${NODE_URL}/admin-api/namespaces`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { namespaceId: "ns-e2e" } }),
      }),
    );
    await page.route(`${NODE_URL}/admin-api/namespaces/ns-e2e/groups`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { groupId: "grp-e2e" } }),
      }),
    );
    await page.route(`${NODE_URL}/admin-api/applications`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { apps: [{ id: "app-e2e", package: "com.calimero.meroblocks" }] } }),
      }),
    );
    await page.route(`${NODE_URL}/admin-api/contexts`, (route) => {
      if (route.request().method() === "POST") {
        created.current = route.request().postDataJSON();
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { contextId: "ctx-created", memberPublicKey: "pk-me" } }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { contexts } }),
      });
    });
    await page.route(`${NODE_URL}/admin-api/contexts/*/join`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
    );
  };

  test("lists this app's worlds and joins one", async ({ page }) => {
    const created = { current: null as unknown };
    await seedAuthOnly(page);
    // the game itself needs jsonrpc once we join; must register FIRST
    const state = freshState();
    await mockNode(page, state);
    await mockAdmin(
      page,
      [
        { id: CTX_ID, applicationId: "app-e2e" },
        { id: "ctx-foreign", applicationId: "someone-else" },
      ],
      created,
    );
    await page.goto("/");

    await expect(page.getByTestId("world-list")).toContainText(CTX_ID);
    await expect(page.getByTestId("world-list")).not.toContainText("ctx-foreign");
    await page.getByTestId("join-world-0").click();
    await page.waitForFunction(() => "__mb" in window);
    await expect(page.getByTestId("debug")).toContainText("online");
    expect(state.methods).toContain("world_meta");
  });

  test("joins a friend's world with a pasted invite code", async ({ page }) => {
    await seedAuthOnly(page);
    const state = freshState();
    await mockNode(page, state);
    await mockAdmin(page, [], { current: null });

    const joined: string[] = [];
    for (const path of ["namespaces/*/join", "groups/*/join-via-inheritance"]) {
      await page.route(`${NODE_URL}/admin-api/${path}`, (route) => {
        joined.push(new URL(route.request().url()).pathname);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
      });
    }

    // the exact string another client would have copied
    const code = encodeInvite({
      invitation: {
        invitation: { inviterIdentity: [1], groupId: [0xab, 0xcd], expirationTimestamp: 9, secretSalt: [2] },
        inviterSignature: "sig",
      },
      groupAlias: "e2e world",
      contextId: CTX_ID,
      groupId: "grp-e2e",
    });

    await page.goto("/");
    await page.getByTestId("invite-input").fill(code);
    await page.getByTestId("join-invite-btn").click();
    await page.waitForFunction(() => "__mb" in window);
    await expect(page.getByTestId("debug")).toContainText("online");
    expect(joined).toEqual([
      "/admin-api/namespaces/abcd/join",
      "/admin-api/groups/grp-e2e/join-via-inheritance",
    ]);
    expect(state.methods).toContain("world_meta"); // actually playing in the invited world
  });

  test("creates a new world through the admin api", async ({ page }) => {
    const created = { current: null as unknown };
    await seedAuthOnly(page);
    const state = freshState();
    await mockNode(page, state);
    await mockAdmin(page, [], created);
    await page.goto("/");

    await expect(page.getByTestId("world-list")).toContainText("No worlds");
    await page.getByTestId("world-name-input").fill("e2e world");
    await page.getByTestId("seed-input").fill("999");
    await page.getByTestId("create-world-btn").click();
    await page.waitForFunction(() => "__mb" in window);

    const body = created.current as {
      applicationId: string;
      groupId: string;
      initializationParams: number[];
    };
    expect(body.applicationId).toBe("app-e2e");
    expect(body.groupId).toBe("grp-e2e"); // context lives in the world's subgroup
    const params = JSON.parse(new TextDecoder().decode(new Uint8Array(body.initializationParams)));
    expect(params.name).toBe("e2e world");
    expect(params.seed).toBe(999);
    await expect(page.getByTestId("debug")).toContainText("online");
  });
});
