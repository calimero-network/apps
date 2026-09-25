import { test, expect } from "@playwright/test";
import { injectMeroAuthTokens } from "./helpers/auth";

const MOCK_NODE_URL = "http://localhost:2428";
const MOCK_ACCESS_TOKEN = "eyJhbGciOiJFZERTQSJ9.mock.signature";

/**
 * Mock: node has no workspaces → popup lands on the no-workspace step.
 */
async function mockEmptyNode(page: import("@playwright/test").Page) {
  await page.route(`${MOCK_NODE_URL}/**`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });
}

/**
 * Mock: node has one workspace but the member has no alias stored → popup
 * lands on the enter-name step.
 */
async function mockNodeWithWorkspace(page: import("@playwright/test").Page) {
  await page.route(`${MOCK_NODE_URL}/**`, (route) => {
    const url = route.request().url();

    // listGroups() calls GET /admin-api/namespaces
    if (url.includes("/admin-api/namespaces") && !url.includes("/invite") && !url.includes("/join")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              groupId: "group-abc123",
              alias: "My Workspace",
              appKey: "app-key",
              targetApplicationId: "app-1",
              upgradePolicy: "Automatic",
              createdAt: 1700000000,
            },
          ],
        }),
      });
    }

    // listMembers() — return identity but no alias so enter-name step shows
    if (url.includes("/admin-api/groups/group-abc123/members")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [{ identity: "pk-member-xyz", alias: "" }],
        }),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: null }),
    });
  });
}

// ── No-workspace flow ─────────────────────────────────────────────────────────

test.describe("No-workspace flow (node has no workspaces)", () => {
  test.beforeEach(async ({ page }) => {
    await injectMeroAuthTokens(page, {
      nodeUrl: MOCK_NODE_URL,
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: "mock-refresh",
    });
    await mockEmptyNode(page);
  });

  test("shows Welcome to MeroChat when no workspace exists", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome to MeroChat")).toBeVisible({ timeout: 10_000 });
  });

  test("shows Create workspace button", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome to MeroChat")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("button", { name: /create workspace/i })).toBeVisible();
  });

  test("clicking Create workspace navigates to create form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome to MeroChat")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /create workspace/i }).click();
    await expect(page.getByText(/create workspace/i).nth(1).or(
      page.locator("label").filter({ hasText: /server name/i })
    )).toBeVisible({ timeout: 5_000 });
  });

  test("Back button in create form returns to no-workspace step", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome to MeroChat")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /create workspace/i }).click();
    await expect(page.getByRole("button", { name: /back/i })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /back/i }).click();
    await expect(page.getByText("Welcome to MeroChat")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: /create workspace/i })).toBeVisible();
  });

  test("shows Disconnect node button", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome to MeroChat")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/disconnect node/i)).toBeVisible();
  });
});

// ── Workspace present, no alias → enter-name step ────────────────────────────

test.describe("Enter-name step (workspace exists, no cached username)", () => {
  test.beforeEach(async ({ page }) => {
    await injectMeroAuthTokens(page, {
      nodeUrl: MOCK_NODE_URL,
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: "mock-refresh",
    });
    await mockNodeWithWorkspace(page);
  });

  test("shows Your name input after identity resolves", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Select workspace")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(
      page.locator("label").filter({ hasText: /your name/i }),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("Join chat button is disabled when name is empty", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Select workspace")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /^continue$/i }).click();
    const joinBtn = page.getByRole("button", { name: /join chat/i });
    await joinBtn.waitFor({ timeout: 10_000 });
    await page.locator("input[type='text'], input:not([type])").first().fill("");
    await expect(joinBtn).toBeDisabled();
  });

  test("shows Disconnect node button in enter-name step", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Select workspace")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /^continue$/i }).click();
    await expect(
      page.locator("label").filter({ hasText: /your name/i }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/disconnect node/i)).toBeVisible();
  });
});

// ── Alias fallback (Phase 3A — needs-fix.md A2 mitigation) ──────────────────

/**
 * Mock: node returns a namespace where the alias field is missing entirely
 * (mirrors what `/admin-api/namespaces` returns on node-2 in rc.35 because
 * the namespace-creation governance op doesn't carry the alias to joiners).
 * The selector should show "Workspace {short-id}", not the raw hex slice.
 */
async function mockNodeWithAliaslessWorkspace(page: import("@playwright/test").Page) {
  await page.route(`${MOCK_NODE_URL}/**`, (route) => {
    const url = route.request().url();
    if (url.includes("/admin-api/namespaces") && !url.includes("/invite") && !url.includes("/join")) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: [
            {
              groupId: "group-aliasless-id-1234567890abcdef",
              // alias intentionally omitted — node-2's view in rc.35
              appKey: "0000000000000000000000000000000000000000000000000000000000000000",
              targetApplicationId: "app-x",
              upgradePolicy: "LazyOnAccess",
              createdAt: 0,
              memberCount: 2,
              contextCount: 1,
              subgroupCount: 0,
            },
          ],
        }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: [] }),
    });
  });
}

test.describe("Workspace selector — missing-alias fallback (Phase 3A)", () => {
  test.beforeEach(async ({ page }) => {
    await injectMeroAuthTokens(page, {
      nodeUrl: MOCK_NODE_URL,
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: "mock-refresh",
    });
    await mockNodeWithAliaslessWorkspace(page);
  });

  test("shows 'Workspace {short-id}' instead of raw hex when alias is absent", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Select workspace")).toBeVisible({ timeout: 10_000 });

    // nsLabel renders "Workspace " + groupId.slice(0, 6). For our mocked
    // groupId "group-aliasless-id-..." that's "Workspace group-" (the
    // dash is the 6th char). The exact slice is fine — what we're
    // verifying is that the user sees the friendly word "Workspace" and
    // NOT a raw bare hex slice.
    const select = page.locator("select");
    await expect(select).toBeVisible();
    await expect(select).toContainText("Workspace group-");

    // Negative: the bare slice without the "Workspace " prefix should
    // never be the visible label.
    const optionText = await select.locator("option").first().innerText();
    expect(optionText.toLowerCase()).toContain("workspace ");
  });
});

// ── Create workspace form ─────────────────────────────────────────────────────

test.describe("Create workspace form", () => {
  test.beforeEach(async ({ page }) => {
    await injectMeroAuthTokens(page, {
      nodeUrl: MOCK_NODE_URL,
      accessToken: MOCK_ACCESS_TOKEN,
      refreshToken: "mock-refresh",
    });
    await mockEmptyNode(page);
  });

  test("shows server name input in create form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome to MeroChat")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /create workspace/i }).click();
    await expect(
      page.locator("label").filter({ hasText: /server name/i }),
    ).toBeVisible({ timeout: 5_000 });
    await expect(page.locator("input[placeholder*='Team']")).toBeVisible();
  });

  test("Create button is disabled when name is empty", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome to MeroChat")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /create workspace/i }).click();
    const createBtn = page.getByRole("button", { name: "Create" });
    await createBtn.waitFor({ timeout: 5_000 });
    await expect(createBtn).toBeDisabled();
  });

  test("Create button enables when name is typed", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Welcome to MeroChat")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /create workspace/i }).click();
    await page.locator("input[placeholder*='Team']").waitFor({ timeout: 5_000 });
    await page.locator("input[placeholder*='Team']").fill("My Team");
    await expect(page.getByRole("button", { name: "Create" })).toBeEnabled();
  });
});
