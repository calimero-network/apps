import { expect, test } from "@playwright/test";
import { decodeInvite, encodeInvite } from "../src/net/inviteCodec";
import { CTX_ID, freshState, mockNode, NODE_URL, seedSession } from "./helpers";

test.describe("landing page", () => {
  test("shows the title screen: panorama, title, controls and the play card", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("landing")).toBeVisible();
    await expect(page.locator("h1")).toContainText("Mero Blocks");
    await expect(page.getByTestId("panorama")).toBeVisible();
    await expect(page.getByTestId("controls")).toContainText("WASD");
    await expect(page.getByTestId("connect-open-btn")).toBeVisible();
    // online-only: no offline entry anywhere
    await expect(page.getByTestId("offline-btn")).toHaveCount(0);
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

  test("anonymous visitors get the connect button; nothing is probed on load", async ({ page }) => {
    const probed: string[] = [];
    for (const port of [2428, 2429, 2528, 2529])
      await page.route(`http://localhost:${port}/admin-api/health`, (route) => {
        probed.push(route.request().url());
        return route.abort();
      });
    await page.goto("/");
    await expect(page.getByTestId("connect-open-btn")).toBeVisible();
    await expect(page.getByTestId("connect-btn")).toHaveCount(0);
    // the popup owns discovery — the landing itself never pings anything
    await expect(page.getByTestId("connect-modal")).toHaveCount(0);
    expect(probed).toEqual([]);
  });

  test("the connect popup lists only the reachable nodes", async ({ page }) => {
    await page.route("http://localhost:2428/admin-api/health", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { status: "alive" } }),
      }),
    );
    for (const port of [2429, 2528, 2529])
      await page.route(`http://localhost:${port}/admin-api/health`, (route) => route.abort());

    await page.goto("/");
    await page.getByTestId("connect-open-btn").click();
    await expect(page.getByTestId("connect-modal")).toBeVisible();
    // only the live node shows up — dead ports are not offered at all
    const nodes = page.getByTestId("discovered-nodes");
    await expect(page.getByTestId("discovered-node-0")).toBeVisible();
    await expect(nodes).toContainText("http://localhost:2428");
    for (const port of [2429, 2528, 2529]) await expect(nodes).not.toContainText(`${port}`);
    // manual entry is always offered alongside
    await expect(page.getByTestId("node-url-input")).toBeVisible();
  });

  test("connecting to a discovered node goes to its auth page", async ({ page }) => {
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
    await page.getByTestId("connect-open-btn").click();
    await page.getByTestId("discovered-node-0").click();
    await page.waitForURL("http://localhost:2428/auth/login**");

    const params = new URL(authUrl!).searchParams;
    expect(params.get("mode")).toBe("multi-context");
    expect(params.get("package-name")).toBe("com.calimero.meroblocks");
  });

  test("manual url: validates, then redirects to the node's auth page", async ({ page }) => {
    for (const port of [2428, 2429, 2528, 2529])
      await page.route(`http://localhost:${port}/admin-api/health`, (route) => route.abort());
    let authUrl: string | null = null;
    await page.route(`${NODE_URL}/auth/login**`, (route) => {
      authUrl = route.request().url();
      return route.fulfill({ status: 200, contentType: "text/html", body: "<h1>node auth</h1>" });
    });
    await page.goto("/");
    await page.getByTestId("connect-open-btn").click();

    await page.getByTestId("node-url-input").fill("not-a-url");
    await page.getByTestId("web-login-btn").click();
    await expect(page.getByTestId("login-error")).toContainText("node's URL");

    await page.getByTestId("node-url-input").fill(NODE_URL);
    await page.getByTestId("web-login-btn").click();
    await page.waitForURL(`${NODE_URL}/auth/login**`);

    const params = new URL(authUrl!).searchParams;
    expect(params.get("mode")).toBe("multi-context");
    expect(params.get("package-name")).toBe("com.calimero.meroblocks");
    expect(params.get("callback-url")).toContain("localhost");
    expect(params.get("permissions")).toContain("context:execute");
  });

  test("says so when no local node is running, and rescan picks up a new one", async ({ page }) => {
    let alive = false;
    await page.route("http://localhost:2428/admin-api/health", (route) =>
      alive
        ? route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({ data: { status: "alive" } }),
          })
        : route.abort(),
    );
    for (const port of [2429, 2528, 2529])
      await page.route(`http://localhost:${port}/admin-api/health`, (route) => route.abort());

    await page.goto("/");
    await page.getByTestId("connect-open-btn").click();
    await expect(page.getByTestId("scan-note")).toContainText("No local nodes found");
    // the manual URL path stays available even with nothing discovered
    await expect(page.getByTestId("node-url-input")).toBeVisible();

    alive = true; // the player started a node — no page refresh needed
    await page.getByTestId("rescan-btn").click();
    await expect(page.getByTestId("discovered-node-0")).toBeVisible();
    await expect(page.getByTestId("scan-note")).not.toContainText("No local nodes found");
  });

  test("the connect popup closes without touching the session", async ({ page }) => {
    for (const port of [2428, 2429, 2528, 2529])
      await page.route(`http://localhost:${port}/admin-api/health`, (route) => route.abort());
    await page.goto("/");
    await page.getByTestId("connect-open-btn").click();
    await expect(page.getByTestId("connect-modal")).toBeVisible();
    await page.getByTestId("connect-close").click();
    await expect(page.getByTestId("connect-modal")).toHaveCount(0);
    await expect(page.getByTestId("connect-open-btn")).toBeVisible();
  });

  test("a connected session shows one-click enter + disconnect", async ({ page }) => {
    await seedSession(page);
    await mockNode(page, freshState());
    await page.goto("/");
    await expect(page.getByTestId("connect-btn")).toBeVisible();
    await page.getByTestId("disconnect-btn").click();
    // back to the anonymous card
    await expect(page.getByTestId("connect-open-btn")).toBeVisible();
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

  /** request bodies captured by mockAdmin for assertions */
  interface CapturedBodies {
    namespace?: Record<string, unknown>;
    group?: Record<string, unknown>;
    context?: Record<string, unknown>;
  }

  // NOTE: register AFTER mockNode — later routes win, and these must shadow
  // mockNode's generic admin-api handler for /applications and /contexts.
  const mockAdmin = async (
    page: import("@playwright/test").Page,
    contexts: { id: string; applicationId?: string }[],
    captured: CapturedBodies,
  ) => {
    // world creation walks namespace → open subgroup → context
    await page.route(`${NODE_URL}/admin-api/namespaces/for-application/*`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }),
    );
    await page.route(`${NODE_URL}/admin-api/namespaces`, (route) => {
      captured.namespace = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { namespaceId: "ns-e2e" } }),
      });
    });
    await page.route(`${NODE_URL}/admin-api/namespaces/ns-e2e/groups`, (route) => {
      captured.group = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { groupId: "grp-e2e" } }),
      });
    });
    await page.route(`${NODE_URL}/admin-api/applications`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { apps: [{ id: "app-e2e", package: "com.calimero.meroblocks" }] } }),
      }),
    );
    await page.route(`${NODE_URL}/admin-api/contexts`, (route) => {
      if (route.request().method() === "POST") {
        captured.context = route.request().postDataJSON();
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
      {},
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
    await mockAdmin(page, [], {});

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

  test("creates a new world: own namespace, OPEN subgroup, context inside it", async ({ page }) => {
    const captured: { namespace?: Record<string, unknown>; group?: Record<string, unknown>; context?: Record<string, unknown> } = {};
    await seedAuthOnly(page);
    const state = freshState();
    await mockNode(page, state);
    await mockAdmin(page, [], captured);
    await page.goto("/");

    await expect(page.getByTestId("world-list")).toContainText("No worlds");
    await page.getByTestId("world-name-input").fill("e2e world");
    await page.getByTestId("seed-input").fill("999");
    await page.getByTestId("create-world-btn").click();
    await page.waitForFunction(() => "__mb" in window);

    // the world gets its OWN namespace, named after it — the name doubles as
    // the alias that travels inside invites (curb pattern)
    expect(captured.namespace?.name).toBe("e2e world");
    expect(captured.namespace?.alias).toBe("e2e world");
    // the subgroup is born open, so invitees can self-join via inheritance
    expect(captured.group).toEqual({ groupName: "e2e world", visibility: "open" });
    const body = captured.context as {
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

  test("shows the node's reason when the invite's subgroup join is refused", async ({ page }) => {
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], {});
    await page.route(`${NODE_URL}/admin-api/groups/grp-e2e/join-via-inheritance`, (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({ error: "identity not eligible for inheritance-based join" }),
      }),
    );

    await page.goto("/");
    await page.getByTestId("invite-input").fill(
      encodeInvite({
        invitation: {
          invitation: { inviterIdentity: [1], groupId: [0xab, 0xcd], expirationTimestamp: 9, secretSalt: [2] },
          inviterSignature: "sig",
        },
        contextId: CTX_ID,
        groupId: "grp-e2e",
      }),
    );
    await page.getByTestId("join-invite-btn").click();

    // a friendly explanation, not "HTTP 403" — and we never enter the world
    await expect(page.getByTestId("picker-error")).toContainText("not open to invited players");
    await expect(page.getByTestId("landing")).toBeVisible();
  });

  test("retries the subgroup join after syncing the namespace", async ({ page }) => {
    await seedAuthOnly(page);
    const state = freshState();
    await mockNode(page, state);
    await mockAdmin(page, [], {});
    let attempts = 0;
    await page.route(`${NODE_URL}/admin-api/groups/grp-e2e/join-via-inheritance`, (route) => {
      attempts++;
      if (attempts === 1)
        return route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "group not found" }),
        });
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
    });

    await page.goto("/");
    await page.getByTestId("invite-input").fill(
      encodeInvite({
        invitation: {
          invitation: { inviterIdentity: [1], groupId: [0xab, 0xcd], expirationTimestamp: 9, secretSalt: [2] },
          inviterSignature: "sig",
        },
        contextId: CTX_ID,
        groupId: "grp-e2e",
      }),
    );
    await page.getByTestId("join-invite-btn").click();
    await page.waitForFunction(() => "__mb" in window);
    await expect(page.getByTestId("debug")).toContainText("online");
    expect(attempts).toBe(2); // failed → namespace sync → succeeded
  });

  test("refuses to enter a world this node holds no identity for", async ({ page }) => {
    await seedAuthOnly(page);
    await mockNode(page, freshState());
    await mockAdmin(page, [], {});
    await page.route(`${NODE_URL}/admin-api/groups/grp-e2e/join-via-inheritance`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) }),
    );
    await page.route(`${NODE_URL}/admin-api/contexts/*/identities-owned`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }),
    );

    await page.goto("/");
    await page.getByTestId("invite-input").fill(
      encodeInvite({
        invitation: {
          invitation: { inviterIdentity: [1], groupId: [0xab, 0xcd], expirationTimestamp: 9, secretSalt: [2] },
          inviterSignature: "sig",
        },
        contextId: CTX_ID,
        groupId: "grp-e2e",
      }),
    );
    await page.getByTestId("join-invite-btn").click();
    await expect(page.getByTestId("picker-error")).toContainText("no identity");
    await expect(page.getByTestId("landing")).toBeVisible();
  });
});

test.describe("minting world invites (connected session)", () => {
  test("flips a restricted world open and pins its ids into the invite", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await seedSession(page);
    await mockNode(page, freshState());
    let flipped: Record<string, unknown> | null = null;
    await page.route(`${NODE_URL}/admin-api/contexts/${CTX_ID}/group`, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: "grp-e2e" }) }),
    );
    await page.route(`${NODE_URL}/admin-api/namespaces/for-application/*`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [{ namespaceId: "ns-e2e" }] }),
      }),
    );
    await page.route(`${NODE_URL}/admin-api/namespaces/ns-e2e/groups`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [{ groupId: "grp-e2e" }] }),
      }),
    );
    await page.route(`${NODE_URL}/admin-api/groups/grp-e2e`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { subgroupVisibility: "restricted" } }),
      }),
    );
    await page.route(`${NODE_URL}/admin-api/groups/grp-e2e/settings/subgroup-visibility`, (route) => {
      flipped = route.request().postDataJSON();
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: {} }) });
    });
    await page.route(`${NODE_URL}/admin-api/namespaces/ns-e2e/invite`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            invitation: {
              invitation: { inviterIdentity: [1], groupId: [0xab, 0xcd], expirationTimestamp: 9, secretSalt: [2] },
              inviterSignature: "sig",
            },
            groupName: "e2e world",
          },
        }),
      }),
    );

    await page.goto("/");
    await page.getByTestId("invite-btn").click();
    await expect(page.getByTestId("invite-btn")).toContainText("Invite copied");

    // legacy restricted world was opened so invitees can actually join
    expect(flipped).toEqual({ subgroupVisibility: "open" });
    const code = await page.evaluate(() => navigator.clipboard.readText());
    const payload = decodeInvite(code)!;
    expect(payload.contextId).toBe(CTX_ID); // invite pins the exact world
    expect(payload.groupId).toBe("grp-e2e");
    expect(payload.groupAlias).toBe("e2e world");
  });
});
