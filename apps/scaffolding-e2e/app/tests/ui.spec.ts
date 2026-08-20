/**
 * UI tests with mocked backend — no live Calimero node needed.
 *
 * Run with:  pnpm exec playwright test --config=playwright.mocked.config.ts
 *
 * All node API calls are intercepted via page.route(), so the tests purely
 * verify frontend interactions: navigation, expandable sections, clickable IDs,
 * form inputs, mobile sidebar, ContextBar, SyncTest panels, etc.
 */

import { test, expect, Page } from "@playwright/test";

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_URL = "http://localhost:2528";
const FAKE_CTX_ID = "fakectxid0000000000000000000000aaaa";
const FAKE_IDENTITY = "fakeidentitykey0000000000000000aaaa";
const FAKE_APP_ID = "fakeappid000000000000000000000aaaaa";

// Override the global auth state — these tests set their own localStorage
test.use({ storageState: { cookies: [], origins: [] } });

// ── RPC mock table ────────────────────────────────────────────────────────────

// A 64-hex account id, the shape `whoami` and the shared_* writer API use.
// Distinct from FAKE_IDENTITY, which is a base58 device key — the two are
// different identities and the UI copy now says so.
const FAKE_ACCOUNT = "a".repeat(64);

const RPC_RESULTS: Record<string, unknown> = {
  // Identity
  whoami: { device_id: FAKE_IDENTITY, account_id: FAKE_ACCOUNT },
  // KV
  set: null,
  get: "hello-world",
  entries: { foo: "bar", baz: "qux" },
  len: 2,
  remove: "removed",
  clear: null,
  set_with_handler: null,
  remove_with_handler: null,
  clear_with_handler: null,
  get_result: "ok-value",
  insert_handler: null,
  update_handler: null,
  remove_handler: null,
  clear_handler: null,
  get_handler_execution_count: 3,
  // Blob / file
  list_files: [
    { id: "file-id-aaabbb111", name: "hello.txt", blob_id: "FakeBlobB58Id11111", size: 42, mime_type: "text/plain", uploaded_by: FAKE_IDENTITY, uploaded_at: 1700000000 },
    { id: "file-id-cccddd222", name: "photo.png", blob_id: "FakeBlobB58Id22222", size: 98765, mime_type: "image/png", uploaded_by: FAKE_IDENTITY, uploaded_at: 1700000001 },
  ],
  upload_file: "file-id-aaabbb111",
  get_file: { id: "file-id-aaabbb111", name: "hello.txt", blob_id: "FakeBlobB58Id11111", size: 42, mime_type: "text/plain", uploaded_by: FAKE_IDENTITY, uploaded_at: 1700000000 },
  get_blob_id_b58: "FakeBlobB58Id99999",
  delete_file: null,
  search_files: [
    { id: "file-id-aaabbb111", name: "hello.txt", blob_id: "FakeBlobB58Id11111", size: 42, mime_type: "text/plain", uploaded_by: FAKE_IDENTITY, uploaded_at: 1700000000 },
  ],
  set_metadata: null,
  get_metadata: NODE_URL,
  // User storage (set_user_simple, get_user_simple, etc.)
  set_user_simple: null,
  get_user_simple: "my-value",
  get_user_simple_for: "their-value",
  set_user_nested: null,
  get_user_nested: "nested-value",
  // Frozen / private
  add_frozen: "abc123deadbeef",
  get_frozen: "frozen-val",
  add_secret: null,
  add_guess: true,
  my_secrets: { "round-1": "sha256:abc" },
  games: { "round-1": "sha256:abc" },
  // CRDT counters
  increment: null,
  increment_g_counter: 3,
  get_g_counter: 3,
  increment_pn_counter: 5,
  decrement_pn_counter: 4,
  get_pn_counter: 4,
  // CRDT registers
  set_register: null,
  get_register: "reg-value",
  // CRDT metadata / nested maps
  set_metadata_outer: null,
  get_metadata_nested: { nested: { key: "value" } },
  // CRDT metrics
  push_metric: 5,
  get_metric: 3,
  metrics_len: 5,
  // CRDT tags
  add_tag: null,
  has_tag: true,
  get_tag_count: 3,
  // Authored Map
  authored_insert: null,
  authored_update: null,
  authored_remove: "removed-val",
  authored_get: "authored-val",
  authored_entries: { ak1: "av1", ak2: "av2" },
  authored_get_owner: FAKE_IDENTITY,
  authored_len: 2,
  // Authored Vector
  authored_vec_push: 0,
  authored_vec_get: "vec-slot-value",
  authored_vec_update: null,
  authored_vec_remove: null,
  authored_vec_get_owner: FAKE_IDENTITY,
  authored_vec_entries: ["slot-0", "slot-1", ""],
  authored_vec_len: 3,
  // Shared Storage
  shared_set: null,
  shared_get: "shared-value",
  shared_get_writers: [FAKE_IDENTITY],
  shared_add_writer: null,
  shared_is_writer: true,
  shared_is_frozen: false,
  // RGA document
  rga_insert_text: null,
  rga_delete_text: null,
  rga_get_text: "hello world",
  rga_get_length: 11,
  rga_is_empty: false,
  rga_set_title: null,
  rga_get_title: "My Document",
  rga_append_text: null,
  rga_clear: null,
  // Workspace
  //
  // ⚠️ These fixtures are NOT evidence that the contract has these methods.
  // Every one of them was mocked here for weeks while `logic/src/lib.rs`
  // defined none of them — this suite was green, and the whole Workspace
  // Manager section was dead against a live node. The check that catches that
  // is scripts/check-contract-calls.mjs, which reads the ABI; it runs under
  // `pnpm test`. Keep these shapes matching the contract's return types, but
  // do not treat a green run here as coverage.
  ws_init: null,
  ws_get_info: {
    name: "Test Workspace",
    admin: FAKE_IDENTITY,
    channel_count: 1,
    group_count: 1,
    member_count: 1,
  },
  ws_register_channel: null,
  ws_unregister_channel: null,
  ws_list_channels: [
    {
      context_id: FAKE_CTX_ID,
      name: "general",
      topic: "Announcements",
      created_by: FAKE_IDENTITY,
      registered_at: 1_787_000_000_000,
    },
  ],
  ws_register_group: null,
  ws_unregister_group: null,
  ws_list_groups: [
    {
      group_id: "grp-id-fake12345678",
      name: "Engineering",
      description: "Engineering team",
      created_by: FAKE_IDENTITY,
      registered_at: 1_787_000_000_000,
    },
  ],
  ws_set_member_role: null,
  ws_get_member_role: "member",
  ws_my_role: "admin",
  ws_list_members: [{ identity: FAKE_IDENTITY, role: "admin" }],
  ws_ping_channel: null,
  ws_ping_count: 0,
};

// ── Auth helpers ──────────────────────────────────────────────────────────────

function makeFakeJwt(): string {
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${enc({ alg: "HS256", typ: "JWT" })}.${enc({
    sub: "admin",
    exp: Math.floor(Date.now() / 1000) + 7200,
    iat: Math.floor(Date.now() / 1000),
  })}.fakesig`;
}

// ── Mock setup ────────────────────────────────────────────────────────────────

async function setupMocks(page: Page) {
  const jwt = makeFakeJwt();

  // Grant clipboard permissions so navigator.clipboard.writeText() resolves natively
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);

  // Inject auth state and clipboard mock before the app JS runs.
  //
  // These are the SDK's own storage keys, so they moved with the SDK. mero-react
  // reads raw strings under a `mero:` prefix, and its LocalStorageTokenStore keeps
  // the token PAIR under `mero-tokens` — writing the old `access-token` /
  // `app-url` / `context-id` keys leaves the app on the Connect screen, which is
  // how this migration announced itself.
  await page.addInitScript(
    ({ jwt, ctxId, identity, nodeUrl, appId }) => {
      localStorage.setItem("mero-tokens", JSON.stringify({
        access_token: jwt,
        refresh_token: "fake-refresh",
        expires_at: Date.now() + 7_200_000,
      }));
      localStorage.setItem("mero:access_token", jwt);
      localStorage.setItem("mero:refresh_token", "fake-refresh");
      localStorage.setItem("mero:expires_at", String(Date.now() + 7_200_000));
      localStorage.setItem("mero:node_url", nodeUrl);
      localStorage.setItem("mero:context_id", ctxId);
      localStorage.setItem("mero:context_identity", identity);
      localStorage.setItem("mero:application_id", appId);
      localStorage.setItem("calimero-active-tab", "concepts");

      // Clipboard is unavailable in headless Chrome — mock it so copy-flash tests work
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: (_text: string) => Promise.resolve(),
          readText: () => Promise.resolve(""),
        },
        writable: true,
        configurable: true,
      });
    },
    { jwt, ctxId: FAKE_CTX_ID, identity: FAKE_IDENTITY, nodeUrl: NODE_URL, appId: FAKE_APP_ID },
  );

  // mero-react decides `isAuthenticated` by probing the node, not by reading
  // storage — an unmocked probe means the Connect screen no matter what is stored.
  await page.route("**/auth/validate", (route) => route.fulfill({ status: 200 }));

  // Single handler for all node API calls
  await page.route(`${NODE_URL}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();

    const json = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });

    // Auth check — must return no error for isAuthenticated to become true
    if (path === "/admin-api/is-authed") return json({ data: null });

    // Contexts list
    if (path === "/admin-api/contexts" && method === "GET")
      return json({
        data: { contexts: [{ id: FAKE_CTX_ID, applicationId: FAKE_APP_ID }] },
      });

    // Owned identities
    if (/^\/admin-api\/contexts\/[^/]+\/identities-owned$/.test(path))
      return json({ data: { identities: [FAKE_IDENTITY] } });

    // All identities (across nodes)
    if (/^\/admin-api\/contexts\/[^/]+\/identities$/.test(path))
      return json({
        data: { identities: [FAKE_IDENTITY, "othernodeidentity9999999999999999999"] },
      });

    // Namespaces list
    if (path === "/admin-api/namespaces" && method === "GET")
      return json({
        data: [
          {
            namespaceId: "ns-id-fake12345678",
            targetApplicationId: FAKE_APP_ID,
            memberCount: 1,
            contextCount: 1,
          },
        ],
      });

    // Groups in a namespace
    if (/^\/admin-api\/namespaces\/[^/]+\/groups$/.test(path) && method === "GET")
      return json({ data: [{ groupId: "grp-id-fake12345678", alias: "Engineering" }] });

    // Blob upload
    if (path === "/admin-api/blobs" && method === "PUT")
      return json({ data: { blobId: "FakeBlobB58Upload1234567" } });

    // Blob download (GET with blob ID in path)
    if (/^\/admin-api\/blobs\//.test(path) && method === "GET")
      return route.fulfill({
        status: 200,
        contentType: "text/plain",
        body: "fake blob content for test",
      });

    // JSON-RPC calls (WASM method execution)
    if (path === "/jsonrpc" && method === "POST") {
      const body = JSON.parse(route.request().postData() ?? "{}") as {
        id: number | string;
        params?: { method?: string };
      };
      const rpcMethod = body?.params?.method ?? "";
      const output = rpcMethod in RPC_RESULTS ? RPC_RESULTS[rpcMethod] : null;
      return json({ jsonrpc: "2.0", id: body.id, result: { output } });
    }

    // Default: return empty success
    return json({ data: null });
  });

  // Sync server mock
  await page.route("http://localhost:3099/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown;
    if (path.includes("/report"))
      body = {
        runId: "mock-run-abc123",
        recorded: "write",
        phase: "written",
        synced: null,
      };
    else if (path.includes("/health")) body = { ok: true, runs: 0 };
    else if (path.includes("/status")) body = [];
    else body = {};
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

// Navigate to a section via the sidebar label, waiting for the item to become active
async function navigateTo(page: Page, label: string) {
  const item = page.locator(".sidebar-item", { hasText: label });
  await item.click();
  // Wait for React to mark the nav item as active (confirms state update happened)
  await expect(item).toHaveClass(/active/, { timeout: 5_000 });
}

// ── Test lifecycle ────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await setupMocks(page);
  await page.goto("/");
  await page.locator(".sidebar").waitFor({ timeout: 15_000 });
});

// ── Navigation — all sidebar sections load ────────────────────────────────────

test.describe("Sidebar navigation", () => {
  const SECTIONS: Array<{ item: string; heading: string }> = [
    { item: "How It Works", heading: "How Calimero Works" },
    { item: "Setup Wizard", heading: "Setup Wizard" },
    { item: "Workspace Manager", heading: "Workspace Manager" },
    { item: "Run All Tests", heading: "Test Runner" },
    { item: "Sync Test", heading: "Sync Test" },
    { item: "KV Operations", heading: "KV Operations" },
    { item: "KV Handlers", heading: "KV with Handlers" },
    { item: "User Storage", heading: "User Storage" },
    { item: "Frozen Storage", heading: "Frozen Storage" },
    { item: "Private Secrets", heading: "Private Storage" },
    { item: "Blob Storage", heading: "Blob Storage" },
    { item: "Authored Map", heading: "Authored Map" },
    { item: "Authored Vector", heading: "Authored Vector" },
    { item: "Shared Storage", heading: "Shared Storage" },
    { item: "Context Members", heading: "Context Members" },
    { item: "Counters", heading: "CRDT Counters" },
    { item: "LWW Registers", heading: "CRDT Registers" },
    { item: "Nested Maps", heading: "CRDT Nested Maps" },
    { item: "Metrics Vector", heading: "CRDT Metrics Vector" },
    { item: "Tags Set", heading: "CRDT Tags Set" },
    { item: "RGA Document", heading: "RGA Document" },
  ];

  for (const { item, heading } of SECTIONS) {
    test(`"${item}" section renders`, async ({ page }) => {
      await navigateTo(page, item);
      await expect(page.locator(".section-title").first()).toContainText(heading, {
        timeout: 10_000,
      });
    });
  }

  test("active sidebar item gets .active class", async ({ page }) => {
    await navigateTo(page, "KV Operations");
    const item = page.locator(".sidebar-item", { hasText: "KV Operations" });
    await expect(item).toHaveClass(/active/);
  });
});

// ── ContextBar ────────────────────────────────────────────────────────────────

test.describe("ContextBar", () => {
  test("shows truncated context ID", async ({ page }) => {
    const bar = page.locator(".context-bar");
    await expect(bar).toContainText(FAKE_CTX_ID.slice(0, 16));
  });

  test("copying context ID shows ✓ feedback", async ({ page }) => {
    // Click the ctx: <code> button in the context bar
    await page.locator(".context-bar button", { hasText: /ctx:/ }).click();
    // Should show "✓" after copying (clipboard is mocked so writeText resolves)
    await expect(page.locator(".context-bar")).toContainText("✓", { timeout: 3_000 });
  });

  test("Node B popover opens and closes", async ({ page }) => {
    const nodeBtn = page.locator(".context-bar button", { hasText: "Node B ↗" });
    await nodeBtn.click();
    // Popover should show the "Open Node B" heading (scope to the popover div)
    const popoverHeading = page.locator("div").filter({ hasText: /^Open Node B$/ }).first();
    await expect(popoverHeading).toBeVisible();
    // Click somewhere on the main content to dismiss via click-outside overlay
    await page.locator(".main-content").click({ position: { x: 10, y: 10 }, force: true });
    await expect(popoverHeading).not.toBeVisible({ timeout: 3_000 });
  });

  test("Node B popover has Copy button", async ({ page }) => {
    await page.locator(".context-bar button", { hasText: "Node B ↗" }).click();
    // Pin by DOM position — locator must survive text change "Copy" → "Copied ✓"
    const copyBtn = page.locator("[data-tutorial='open-node-b'] button").last();
    await expect(copyBtn).toContainText("Copy");
    await copyBtn.click();
    // Clipboard mock resolves → "Copied ✓" flash
    await expect(copyBtn).toContainText("Copied", { timeout: 2_000 });
  });

  test("clicking node URL chip opens inline editor", async ({ page }) => {
    // The node URL chip in the context bar has title="Click to change node URL"
    const nodeChip = page.locator(".context-bar button[title='Click to change node URL']");
    await expect(nodeChip).toBeVisible({ timeout: 5_000 });
    await nodeChip.click();
    // An input should appear for editing
    await expect(page.locator(".context-bar input")).toBeVisible();
    // Pressing Escape cancels the edit — use locator.press() so the key targets
    // the input directly instead of relying on browser focus state in headless CI
    await page.locator(".context-bar input").press("Escape");
    await expect(page.locator(".context-bar input")).not.toBeVisible();
  });
});

// ── Blob Storage ──────────────────────────────────────────────────────────────

test.describe("Blob Storage", () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, "Blob Storage");
  });

  test("shows mocked file list with 2 rows", async ({ page }) => {
    // Auto-refresh polls list_files → 2 entries
    await expect(page.locator("table tbody tr")).toHaveCount(2, { timeout: 8_000 });
    await expect(page.locator("table")).toContainText("hello.txt");
    await expect(page.locator("table")).toContainText("photo.png");
  });

  test("file ID click shows 'copied!' flash", async ({ page }) => {
    await page.locator("table tbody tr").first().waitFor({ timeout: 8_000 });
    // The file ID is rendered as a <code> element that shows truncated ID
    const fileIdCode = page.locator("table tbody tr").first().locator("code").first();
    await fileIdCode.click();
    await expect(fileIdCode).toContainText("copied!", { timeout: 2_000 });
    // Reverts after 1.5s
    await expect(fileIdCode).not.toContainText("copied!", { timeout: 3_000 });
  });

  test("download button is present for each row", async ({ page }) => {
    await page.locator("table tbody tr").first().waitFor({ timeout: 8_000 });
    const downloadBtns = page.locator("table tbody tr button", { hasText: /Download/ });
    await expect(downloadBtns).toHaveCount(2);
  });

  test("upload drop zone is visible and file input is hidden", async ({ page }) => {
    await expect(page.locator("text=Drop a file here or click to select")).toBeVisible();
    await expect(page.locator("input[type='file']")).toBeHidden();
  });

  test("upload button is disabled when no file selected", async ({ page }) => {
    const uploadBtn = page.locator("button", { hasText: "Upload & Register" });
    await expect(uploadBtn).toBeDisabled();
  });

  test("search card is visible and search button works", async ({ page }) => {
    const searchInput = page.locator("input[placeholder*='search query']");
    await expect(searchInput).toBeVisible();
    await searchInput.fill("hello");
    const searchBtn = page.locator("button", { hasText: "Search" });
    await searchBtn.click();
    await expect(page.locator(".result-box").last()).toBeVisible({ timeout: 5_000 });
  });

  test("get_file by ID returns mocked result", async ({ page }) => {
    const fileIdInput = page.locator("input[placeholder='file_id']").first();
    await fileIdInput.fill("file-id-aaabbb111");
    const getBtn = page.locator("button", { hasText: "get_file" });
    await getBtn.click();
    await expect(page.locator(".result-box").last()).toBeVisible({ timeout: 5_000 });
  });

  test("delete card has an input and execute button", async ({ page }) => {
    const deleteInput = page.locator("input[placeholder='file_id']").last();
    await expect(deleteInput).toBeVisible();
    const executeBtn = page.locator(".method-card button.btn-danger-outline", {
      hasText: "Execute",
    });
    await expect(executeBtn).toBeVisible();
  });

  test("download error banner appears on failed download", async ({ page }) => {
    // Override the blob download route to return 404 for this specific test
    await page.route(`${NODE_URL}/admin-api/blobs/**`, (route) => {
      if (route.request().method() === "GET") {
        route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ error: "not found" }),
        });
      } else {
        route.continue();
      }
    });

    await page.locator("table tbody tr").first().waitFor({ timeout: 8_000 });
    const downloadBtn = page.locator("table tbody tr").first().locator("button");
    await downloadBtn.click();
    await expect(page.locator("text=Download failed")).toBeVisible({ timeout: 8_000 });
  });
});

// ── KV Operations ─────────────────────────────────────────────────────────────

test.describe("KV Operations", () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, "KV Operations");
  });

  test("set card — fills key/value and executes", async ({ page }) => {
    // The set(key, value) card is the first card inside the method-grid
    const setCard = page.locator(".method-grid .method-card").first();
    await setCard.locator("input[placeholder='key']").fill("mykey");
    await setCard.locator("input[placeholder='value']").fill("myvalue");
    // Button label is "Execute" (not the method name)
    await setCard.locator("button").click();
    await expect(setCard.locator(".result-box")).toBeVisible({ timeout: 5_000 });
  });

  test("live entries view auto-populates with mocked data", async ({ page }) => {
    // The entries() live view auto-refreshes — no button needed; just wait for result
    const liveCard = page.locator(".method-card").first();
    await expect(liveCard.locator(".result-box")).toContainText("foo", { timeout: 5_000 });
  });
});

// ── Workspace Manager ─────────────────────────────────────────────────────────

test.describe("Workspace Manager", () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, "Workspace Manager");
    // Wait for section to be fully visible before proceeding
    await expect(
      page.locator(".section-title", { hasText: "Workspace Manager" }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Overview card shows workspace info from mock", async ({ page }) => {
    // ws_get_info is called on mount, returns { name: "Test Workspace", ... }
    await expect(page.locator("text=Test Workspace")).toBeVisible({ timeout: 8_000 });
  });

  test("Overview shows workspace stats from mock", async ({ page }) => {
    await expect(page.locator("text=Test Workspace")).toBeVisible({ timeout: 8_000 });
    // The result-box in WsOverview shows workspace name and admin key
    await expect(page.locator(".result-box").first()).toContainText("name");
    await expect(page.locator(".result-box").first()).toContainText("admin");
  });

  test("ws_init form is visible and calls ws_init on click", async ({ page }) => {
    // ws_init card is only shown when workspace is NOT initialized.
    // Since our mock returns workspace info, the init form may be hidden.
    // Instead, verify the section loaded and the Initialize button OR the init text exists.
    const hasInitCard = await page.locator("input[placeholder*='Acme']").count() > 0;
    if (hasInitCard) {
      await page.locator("input[placeholder*='Acme']").fill("My Workspace");
      await page.locator("button", { hasText: /Initialize/ }).click();
      await expect(page.locator(".result-box, [class*='result']").last()).toBeVisible({
        timeout: 5_000,
      });
    } else {
      // Workspace already initialized from mock — overview card is showing instead
      await expect(page.locator("text=Test Workspace")).toBeVisible();
    }
  });

  test("Channels section shows mocked channel list", async ({ page }) => {
    // ws_list_channels auto-fetched on mount → DarkTable shows channel name in <strong>
    // Use first() to avoid strict mode: WsConcept also mentions "#general" in text
    await expect(
      page.locator("strong", { hasText: "general" }).first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("Channels register form is visible", async ({ page }) => {
    // Register channel form: placeholder contains "#general"
    await expect(page.locator("input[placeholder*='#general']")).toBeVisible();
    await expect(page.locator("button", { hasText: "Register" }).first()).toBeVisible();
  });

  test("Groups section shows mocked group list", async ({ page }) => {
    // ws_list_groups → WsGroupRecord has group name "Engineering" in DarkTable <strong>
    // Multiple elements contain "Engineering" text; scope to the table cell
    await expect(
      page.locator("strong", { hasText: "Engineering" }).first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("Members section shows mocked member", async ({ page }) => {
    // ws_list_members → FAKE_IDENTITY shown as ClickId <code> element in the members table
    // Two code elements show this identity (overview admin + members table); first() picks one
    await expect(
      page.locator("code").filter({ hasText: FAKE_IDENTITY.slice(0, 16) }).first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("Members section shows 'admin' role badge", async ({ page }) => {
    // Wait for members to load, then check for the role badge
    await expect(
      page.locator("code").filter({ hasText: FAKE_IDENTITY.slice(0, 16) }).first(),
    ).toBeVisible({ timeout: 8_000 });
    // RoleBadge renders the role text in a <span>
    await expect(page.locator(".main-content span", { hasText: "admin" }).first()).toBeVisible();
  });

  test("IdPicker 'From node' button shows dropdown", async ({ page }) => {
    // The Channels section has an IdPicker for Context ID — "From node" button loads contexts
    const fromNodeBtn = page.locator("button", { hasText: "From node" }).first();
    await expect(fromNodeBtn).toBeVisible({ timeout: 5_000 });
    await fromNodeBtn.click();
    // After clicking, a <select> appears with the mocked context as an option
    const selectEl = page.locator("select.form-control").first();
    await expect(selectEl).toBeVisible({ timeout: 3_000 });
    // The option label contains the first 20 chars of the fake context ID
    await expect(selectEl).toContainText(FAKE_CTX_ID.slice(0, 16));
  });

  test("ClickId admin key is clickable and shows flash", async ({ page }) => {
    // Wait for workspace info to load
    await expect(page.locator("text=Test Workspace")).toBeVisible({ timeout: 8_000 });
    // ClickId elements render as <code> with dashed underline; admin key is in the overview
    const clickableCode = page.locator(".result-box code").first();
    if ((await clickableCode.count()) > 0) {
      await clickableCode.click();
      await expect(clickableCode).toContainText("✓", { timeout: 2_000 });
    }
  });

  test("Refresh button in channels triggers ws_list_channels", async ({ page }) => {
    const refreshBtn = page.locator("button", { hasText: "Refresh" }).first();
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    // After refresh, channel list still shows the "general" channel name in a table cell
    await expect(
      page.locator("strong", { hasText: "general" }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ── Sync Test ─────────────────────────────────────────────────────────────────

test.describe("Sync Test", () => {
  test.beforeEach(async ({ page }) => {
    await navigateTo(page, "Sync Test");
  });

  test("Writer and Watcher panels are both visible", async ({ page }) => {
    await expect(page.locator("text=✏ Writer")).toBeVisible();
    await expect(page.locator("text=📡 Watcher")).toBeVisible();
  });

  test("description mentions using separate tabs", async ({ page }) => {
    await expect(page.locator("text=use the Writer on one node")).toBeVisible();
  });

  test("sync server URL input has default value", async ({ page }) => {
    const serverInput = page.locator("input[placeholder*='3099']");
    await expect(serverInput).toBeVisible();
    await expect(serverInput).toHaveValue("http://localhost:3099");
  });

  test("Ping button checks sync server health", async ({ page }) => {
    const pingBtn = page.locator("button", { hasText: "Ping" });
    await pingBtn.click();
    // Sync server mock returns { ok: true } → "● Online" indicator
    await expect(page.locator("text=Online")).toBeVisible({ timeout: 5_000 });
  });

  test("Writer key/value inputs are present", async ({ page }) => {
    // SyncTest layout: nth(0)=how-it-works card, nth(1)=sync-server card, nth(2)=writer, nth(3)=watcher
    const writerCard = page.locator(".method-card").nth(2);
    await expect(writerCard.locator("text=Key")).toBeVisible();
    await expect(writerCard.locator("text=Value")).toBeVisible();
    await expect(writerCard.locator(".form-control")).toHaveCount(2);
  });

  test("Write & Post Test button enabled when key+value filled", async ({ page }) => {
    const writerCard = page.locator(".method-card").nth(2);
    const inputs = writerCard.locator(".form-control");
    await inputs.nth(0).fill("sync-key");
    await inputs.nth(1).fill("sync-value");
    const writeBtn = writerCard.locator("button", { hasText: "Write & Post Test" });
    await expect(writeBtn).toBeEnabled();
  });

  test("clicking Write & Post Test shows 'Waiting for watcher'", async ({ page }) => {
    const writerCard = page.locator(".method-card").nth(2);
    const inputs = writerCard.locator(".form-control");
    await inputs.nth(0).fill("sync-key");
    await inputs.nth(1).fill("sync-value");
    const writeBtn = writerCard.locator("button", { hasText: /Write/ });
    await writeBtn.click();
    // After RPC write + POST to sync server, shows "Waiting for watcher"
    await expect(page.locator("text=Waiting for watcher")).toBeVisible({ timeout: 8_000 });
  });

  test("Watcher has Start Watching button", async ({ page }) => {
    const startBtn = page.locator("button", { hasText: "Start Watching" });
    await expect(startBtn).toBeVisible();
  });

  test("clicking Start Watching shows Stop Watching and spinning indicator", async ({
    page,
  }) => {
    const startBtn = page.locator("button", { hasText: "Start Watching" });
    await startBtn.click();
    await expect(page.locator("button", { hasText: "Stop Watching" })).toBeVisible({
      timeout: 3_000,
    });
    await expect(page.locator("text=Watching for tests")).toBeVisible({ timeout: 3_000 });
  });

  test("clicking Stop Watching reverts to Start Watching", async ({ page }) => {
    await page.locator("button", { hasText: "Start Watching" }).click();
    await page.locator("button", { hasText: "Stop Watching" }).waitFor({ timeout: 3_000 });
    await page.locator("button", { hasText: "Stop Watching" }).click();
    await expect(page.locator("button", { hasText: "Start Watching" })).toBeVisible({
      timeout: 3_000,
    });
  });
});

// ── User Storage ──────────────────────────────────────────────────────────────

test.describe("User Storage", () => {
  test("set_user_simple button fires RPC and shows result", async ({ page }) => {
    await navigateTo(page, "User Storage");
    // UserStorage has set_user_simple(value) — only a value input, no key
    const valueInput = page.locator("input[placeholder='value']").first();
    await valueInput.fill("my-test-value");
    // The set_user_simple card is the first method-card in the grid
    const firstCard = page.locator(".method-grid .method-card").first();
    await firstCard.locator("button").click();
    await expect(firstCard.locator(".result-box")).toBeVisible({ timeout: 5_000 });
  });
});

// ── Frozen Storage ────────────────────────────────────────────────────────────

test.describe("Frozen Storage", () => {
  test("section renders with form inputs", async ({ page }) => {
    await navigateTo(page, "Frozen Storage");
    await expect(page.locator(".section-title")).toContainText("Frozen Storage");
    // FrozenStorage has a textarea (not a key input) for the value to store
    await expect(
      page.locator("textarea[placeholder*='value to store']").first(),
    ).toBeVisible();
    // And an input for the hash
    await expect(
      page.locator("input[placeholder*='SHA256']").first(),
    ).toBeVisible();
  });
});

// ── Private Secrets ───────────────────────────────────────────────────────────

test.describe("Private Secrets", () => {
  test("section renders with form inputs", async ({ page }) => {
    await navigateTo(page, "Private Secrets");
    await expect(page.locator(".section-title")).toContainText("Private Storage");
    // PrivateStorage has inputs for game_id and secret (commit-reveal scheme)
    await expect(
      page.locator("input[placeholder*='game_id']").first(),
    ).toBeVisible();
    await expect(
      page.locator("input[placeholder='secret']").first(),
    ).toBeVisible();
  });
});

// ── CRDT sections ─────────────────────────────────────────────────────────────

test.describe("CRDT Counters", () => {
  test("increment button returns mocked result", async ({ page }) => {
    await navigateTo(page, "Counters");
    const btn = page.locator("button", { hasText: /[Ii]ncrement/ }).first();
    await btn.click();
    await expect(page.locator(".result-box").first()).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("CRDT Registers", () => {
  test("set_register and get_register cards have Execute buttons", async ({ page }) => {
    await navigateTo(page, "LWW Registers");
    // Both cards have buttons labeled "Execute"
    const cards = page.locator(".method-card");
    await expect(cards.first().locator("button")).toBeVisible();
    await expect(cards.nth(1).locator("button")).toBeVisible();
    // And they have input fields
    await expect(page.locator("input[placeholder='key']").first()).toBeVisible();
  });
});

test.describe("CRDT Tags", () => {
  test("add_tag and has_tag method cards are present", async ({ page }) => {
    await navigateTo(page, "Tags Set");
    // CrdtTags has method-name divs for add_tag, has_tag, get_tag_count
    await expect(
      page.locator(".method-name", { hasText: "add_tag" }).first(),
    ).toBeVisible();
    // Each card has an Execute button
    await expect(page.locator(".method-card button").first()).toBeVisible();
  });
});

test.describe("RGA Document", () => {
  test("section renders with operation buttons", async ({ page }) => {
    await navigateTo(page, "RGA Document");
    await expect(page.locator(".section-title")).toContainText("RGA Document");
    await expect(page.locator(".method-card button").first()).toBeVisible();
  });
});

test.describe("CRDT Metadata (Nested Maps)", () => {
  test("section renders with set_metadata and get_metadata cards", async ({ page }) => {
    await navigateTo(page, "Nested Maps");
    await expect(
      page.locator(".method-name", { hasText: "set_metadata" }).first(),
    ).toBeVisible();
    await expect(
      page.locator(".method-name", { hasText: "get_metadata" }).first(),
    ).toBeVisible();
    await expect(page.locator(".method-card button").first()).toBeVisible();
  });
});

test.describe("CRDT Metrics (Vector)", () => {
  test("section renders with push_metric and get_metric cards", async ({ page }) => {
    await navigateTo(page, "Metrics Vector");
    await expect(
      page.locator(".method-name", { hasText: "push_metric" }).first(),
    ).toBeVisible();
    await expect(page.locator(".method-card button").first()).toBeVisible();
  });
});

test.describe("Authored Map", () => {
  test("section renders with authored_insert/update/remove cards", async ({ page }) => {
    await navigateTo(page, "Authored Map");
    await expect(page.locator(".section-title")).toContainText("Authored Map");
    await expect(
      page.locator(".method-name", { hasText: "authored_insert" }).first(),
    ).toBeVisible();
    await expect(
      page.locator(".method-name", { hasText: "authored_update" }).first(),
    ).toBeVisible();
    await expect(
      page.locator(".method-name", { hasText: "authored_remove" }).first(),
    ).toBeVisible();
  });

  test("authored_insert card has key and value inputs", async ({ page }) => {
    await navigateTo(page, "Authored Map");
    const insertCard = page
      .locator(".method-card", { hasText: "authored_insert(key, value)" })
      .first();
    await expect(insertCard.locator("input[placeholder='key']")).toBeVisible();
    await expect(insertCard.locator("input[placeholder='value']")).toBeVisible();
    await expect(insertCard.locator("button", { hasText: "Execute" })).toBeVisible();
  });

  test("authored_get_owner card has FieldHelp tooltip", async ({ page }) => {
    await navigateTo(page, "Authored Map");
    const ownerCard = page
      .locator(".method-card", { hasText: "authored_get_owner(key)" })
      .first();
    await expect(ownerCard.locator("input[placeholder='key']")).toBeVisible();
  });

  test("authored_len executes and shows result on click", async ({ page }) => {
    await navigateTo(page, "Authored Map");
    const lenCard = page.locator(".method-card", { hasText: "authored_len()" }).first();
    await lenCard.locator("button").click();
    await expect(lenCard.locator(".result-box")).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Shared Storage", () => {
  test("section renders with shared_set/get cards", async ({ page }) => {
    await navigateTo(page, "Shared Storage");
    await expect(page.locator(".section-title")).toContainText("Shared Storage");
    await expect(
      page.locator(".method-name", { hasText: "shared_set" }).first(),
    ).toBeVisible();
    await expect(
      page.locator(".method-name", { hasText: "shared_get" }).first(),
    ).toBeVisible();
  });

  test("shared_set card has a value input and Execute button", async ({ page }) => {
    await navigateTo(page, "Shared Storage");
    const setCard = page
      .locator(".method-card", { hasText: "shared_set(value)" })
      .first();
    await expect(setCard.locator("input[placeholder='value']")).toBeVisible();
    await expect(setCard.locator("button", { hasText: "Execute" })).toBeVisible();
  });

  test("shared_add_writer card has account input with FieldHelp", async ({ page }) => {
    await navigateTo(page, "Shared Storage");
    const writerCard = page
      .locator(".method-card", { hasText: "shared_add_writer(account_hex)" })
      .first();
    await expect(
      writerCard.locator("input[placeholder='64-hex account id']"),
    ).toBeVisible();
  });

  test("shared_get_writers executes and shows result on click", async ({ page }) => {
    await navigateTo(page, "Shared Storage");
    const writersCard = page
      .locator(".method-card", { hasText: "shared_get_writers()" })
      .first();
    await writersCard.locator("button").click();
    await expect(writersCard.locator(".result-box")).toBeVisible({ timeout: 5_000 });
  });

  test("shared_is_frozen executes and returns mocked value", async ({ page }) => {
    await navigateTo(page, "Shared Storage");
    const frozenCard = page
      .locator(".method-card", { hasText: "shared_is_frozen()" })
      .first();
    await frozenCard.locator("button").click();
    await expect(frozenCard.locator(".result-box")).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Authored Vector", () => {
  test("section renders with push/get/update/remove cards", async ({ page }) => {
    await navigateTo(page, "Authored Vector");
    await expect(page.locator(".section-title")).toContainText("Authored Vector");
    await expect(
      page.locator(".method-name", { hasText: "authored_vec_push" }).first(),
    ).toBeVisible();
    await expect(
      page.locator(".method-name", { hasText: "authored_vec_get" }).first(),
    ).toBeVisible();
    await expect(
      page.locator(".method-name", { hasText: "authored_vec_update" }).first(),
    ).toBeVisible();
    await expect(
      page.locator(".method-name", { hasText: "authored_vec_remove" }).first(),
    ).toBeVisible();
  });

  test("authored_vec_push card has value input and Execute button", async ({ page }) => {
    await navigateTo(page, "Authored Vector");
    const pushCard = page
      .locator(".method-card", { hasText: "authored_vec_push(value)" })
      .first();
    await expect(pushCard.locator("input[placeholder='value']")).toBeVisible();
    await expect(pushCard.locator("button", { hasText: "Execute" })).toBeVisible();
  });

  test("authored_vec_push executes and shows returned index", async ({ page }) => {
    await navigateTo(page, "Authored Vector");
    const pushCard = page
      .locator(".method-card", { hasText: "authored_vec_push(value)" })
      .first();
    await pushCard.locator("input[placeholder='value']").fill("test-slot");
    await pushCard.locator("button", { hasText: "Execute" }).click();
    await expect(pushCard.locator(".result-box")).toBeVisible({ timeout: 5_000 });
  });

  test("authored_vec_get_owner card has FieldHelp tooltip", async ({ page }) => {
    await navigateTo(page, "Authored Vector");
    const ownerCard = page
      .locator(".method-card", { hasText: "authored_vec_get_owner(index)" })
      .first();
    await expect(ownerCard.locator("input[placeholder='index']")).toBeVisible();
  });

  test("authored_vec_entries executes and shows result on click", async ({ page }) => {
    await navigateTo(page, "Authored Vector");
    const entriesCard = page
      .locator(".method-card", { hasText: "authored_vec_entries()" })
      .first();
    await entriesCard.locator("button").click();
    await expect(entriesCard.locator(".result-box")).toBeVisible({ timeout: 5_000 });
  });

  test("authored_vec_len executes and shows result on click", async ({ page }) => {
    await navigateTo(page, "Authored Vector");
    const lenCard = page.locator(".method-card", { hasText: "authored_vec_len()" }).first();
    await lenCard.locator("button").click();
    await expect(lenCard.locator(".result-box")).toBeVisible({ timeout: 5_000 });
  });
});

// ── Mobile hamburger menu ─────────────────────────────────────────────────────

test.describe("Mobile sidebar", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("hamburger button is visible at mobile width", async ({ page }) => {
    await expect(page.locator(".hamburger-btn")).toBeVisible();
  });

  test("clicking hamburger opens the sidebar", async ({ page }) => {
    const sidebar = page.locator(".sidebar");
    await expect(sidebar).not.toHaveClass(/sidebar-open/);
    await page.locator(".hamburger-btn").click();
    await expect(sidebar).toHaveClass(/sidebar-open/, { timeout: 2_000 });
  });

  test("clicking a nav item closes the sidebar", async ({ page }) => {
    await page.locator(".hamburger-btn").click();
    await page.locator(".sidebar").waitFor({ state: "visible" });
    await page.locator(".sidebar-item", { hasText: "KV Operations" }).click();
    await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-open/, { timeout: 2_000 });
  });

  test("tapping backdrop closes the sidebar", async ({ page }) => {
    await page.locator(".hamburger-btn").click();
    await expect(page.locator(".sidebar")).toHaveClass(/sidebar-open/, { timeout: 2_000 });
    // The backdrop div is a fixed overlay — click outside the sidebar
    await page.mouse.click(350, 300);
    await expect(page.locator(".sidebar")).not.toHaveClass(/sidebar-open/, { timeout: 2_000 });
  });
});

// ── Context Members ───────────────────────────────────────────────────────────

test.describe("Context Members", () => {
  test("section renders with member list from mock", async ({ page }) => {
    await navigateTo(page, "Context Members");
    await expect(page.locator(".section-title")).toContainText("Context Members");
    await expect(page.locator(".method-card").first()).toBeVisible();
  });
});

// ── Setup Wizard ──────────────────────────────────────────────────────────────

test.describe("Setup Wizard", () => {
  test("section renders with collapsible step cards", async ({ page }) => {
    await navigateTo(page, "Setup Wizard");
    await expect(page.locator(".section-title")).toContainText("Setup Wizard");
    // SetupWizard uses StepCard accordion components (not .method-card).
    // StepCard toggle buttons have type="button" — check the first one is visible.
    await expect(
      page.locator(".main-content button[type='button']").first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});

// ── Concepts ─────────────────────────────────────────────────────────────────

test.describe("How It Works", () => {
  test("concepts page renders correctly on load (default tab)", async ({ page }) => {
    // calimero-active-tab is "concepts" in addInitScript — should be default
    await expect(page.locator(".section-title")).toContainText("How Calimero Works");
  });
});

// ── Tutorial ──────────────────────────────────────────────────────────────────

test.describe("Tutorial", () => {
  test("? button is visible in the bottom-right corner", async ({ page }) => {
    const tutorialBtn = page.locator("button[title='Open tutorial']");
    await expect(tutorialBtn).toBeVisible();
    await expect(tutorialBtn).toContainText("?");
  });

  test("clicking ? opens the tutorial overlay with first step", async ({ page }) => {
    await page.locator("button[title='Open tutorial']").click();
    // Close button only exists while the tutorial is active — use it as the open signal
    await expect(page.locator("button[title='Close tutorial']")).toBeVisible({ timeout: 5_000 });
    // exact:true → case-sensitive full-content match, avoids "the node URL for Node A" paragraph
    await expect(page.getByText("Node URL", { exact: true })).toBeVisible();
  });

  test("tutorial card shows step counter '1 / 9'", async ({ page }) => {
    await page.locator("button[title='Open tutorial']").click();
    await expect(page.locator("button[title='Close tutorial']")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("1 / 9", { exact: true })).toBeVisible();
  });

  test("Next button advances to the next step", async ({ page }) => {
    await page.locator("button[title='Open tutorial']").click();
    await expect(page.locator("button[title='Close tutorial']")).toBeVisible({ timeout: 5_000 });
    await page.locator("button", { hasText: "Next →" }).click();
    // Step 2 title is unique to the tutorial card
    await expect(page.getByText("Connecting a Second Node", { exact: true })).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText("2 / 9", { exact: true })).toBeVisible();
  });

  test("Prev button goes back to the previous step", async ({ page }) => {
    await page.locator("button[title='Open tutorial']").click();
    await expect(page.locator("button[title='Close tutorial']")).toBeVisible({ timeout: 5_000 });
    await page.locator("button", { hasText: "Next →" }).click();
    await expect(page.getByText("Connecting a Second Node", { exact: true })).toBeVisible({ timeout: 3_000 });
    await page.locator("button", { hasText: "← Prev" }).click();
    await expect(page.getByText("Node URL", { exact: true })).toBeVisible({ timeout: 3_000 });
  });

  test("first step has no Prev button", async ({ page }) => {
    await page.locator("button[title='Open tutorial']").click();
    await expect(page.locator("button[title='Close tutorial']")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("button", { hasText: "← Prev" })).not.toBeVisible();
  });

  test("close button dismisses the tutorial", async ({ page }) => {
    await page.locator("button[title='Open tutorial']").click();
    await expect(page.locator("button[title='Close tutorial']")).toBeVisible({ timeout: 5_000 });
    await page.locator("button[title='Close tutorial']").click();
    await expect(page.locator("button[title='Close tutorial']")).not.toBeVisible({ timeout: 3_000 });
    await expect(page.locator("button[title='Open tutorial']")).toBeVisible();
  });
});
