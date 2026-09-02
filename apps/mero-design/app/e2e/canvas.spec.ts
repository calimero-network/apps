import { test, expect } from "@playwright/test";

// Inject auth state so we land directly on the canvas.
// Tokens live in the mero token store (mero-tokens) + mero-react storage keys.
async function injectAuth(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    // JWT payload: {"sub":"test-identity"} — must match TEST_MEMBER.id in mockRpc
    localStorage.setItem("mero-tokens", JSON.stringify({
      access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LWlkZW50aXR5In0.sig",
      refresh_token: "fake-refresh",
      expires_at: Date.now() + 3600_000,
    }));
    localStorage.setItem("mero:node_url", "http://localhost:2430");
    localStorage.setItem("mero:application_id", "app-1");
  });
}

// mero-react <4.1.1 gated isAuthenticated on a GET /admin-api/contexts probe;
// since 4.1.1 checkAuth probes HEAD /auth/validate instead. Mock both.
async function mockContexts(page: import("@playwright/test").Page) {
  await page.route("**/auth/validate", (route) => route.fulfill({ status: 200 }));
  await page.route("**/admin-api/contexts", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: { contexts: [] } }),
    }),
  );
}

function mockRpc(page: import("@playwright/test").Page) {
  mockIdentities(page);
  return page.route("**/jsonrpc", (route) => {
    const body = route.request().postDataJSON() as { params?: { method?: string } };
    const method = body?.params?.method ?? "";
    // Return the test identity as a registered member so the username modal doesn't appear
    const TEST_MEMBER = { id: "test-identity", username: "Tester", avatar: null, joinedAt: 1000 };
    const value = method === "get_members" ? [TEST_MEMBER] : [];
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(value)));
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: { output: bytes, logs: [] } }),
    });
  });
}

function mockSse(page: import("@playwright/test").Page) {
  page.route("**/events**", (route) => route.abort());
  return page.route("**/sse**", (route) => route.abort());
}

function mockIdentities(page: import("@playwright/test").Page) {
  return page.route("**/admin-api/contexts/**/identities-owned", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data: ["test-identity"] }),
    }),
  );
}

test.describe("Canvas page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
    await mockContexts(page);
    await mockRpc(page);  // includes mockIdentities
    await mockSse(page);
    await page.goto("/teams/team-1/projects/project-1");
    await expect(page.getByTestId("fabric-canvas")).toBeVisible({ timeout: 8000 });
  });

  test("renders toolbar with all drawing tools", async ({ page }) => {
    for (const id of ["select", "rect", "circle", "line", "arrow", "path", "text", "image"]) {
      await expect(page.getByTestId(`tool-${id}`)).toBeVisible();
    }
  });

  test("renders Options button and export buttons inside dropdown", async ({ page }) => {
    await expect(page.getByTestId("options-btn")).toBeVisible();
    await page.getByTestId("options-btn").click();
    await expect(page.getByTestId("export-png")).toBeVisible();
    await expect(page.getByTestId("export-svg")).toBeVisible();
  });

  test("renders background color buttons inside Options dropdown", async ({ page }) => {
    await page.getByTestId("options-btn").click();
    await expect(page.getByTestId("bg-w")).toBeVisible();
    await expect(page.getByTestId("bg-g")).toBeVisible();
    await expect(page.getByTestId("bg-b")).toBeVisible();
  });

  test("clicking a tool activates it (rect)", async ({ page }) => {
    await page.getByTestId("tool-rect").click();
    await expect(page.getByTestId("tool-rect")).toHaveClass(/active/);
  });

  test("clicking a tool activates it (circle)", async ({ page }) => {
    await page.getByTestId("tool-circle").click();
    await expect(page.getByTestId("tool-circle")).toHaveClass(/active/);
  });

  test("background gray button applies .bgActive class", async ({ page }) => {
    await page.getByTestId("options-btn").click();
    await page.getByTestId("bg-g").click();
    await page.getByTestId("options-btn").click();
    await expect(page.getByTestId("bg-g")).toHaveClass(/bgActive/);
  });

  test("background black button applies .bgActive class", async ({ page }) => {
    await page.getByTestId("options-btn").click();
    await page.getByTestId("bg-b").click();
    await page.getByTestId("options-btn").click();
    await expect(page.getByTestId("bg-b")).toHaveClass(/bgActive/);
  });

  test("background white button is active by default", async ({ page }) => {
    await page.getByTestId("options-btn").click();
    await expect(page.getByTestId("bg-w")).toHaveClass(/bgActive/);
  });

  test("properties panel shows placeholder when nothing selected", async ({ page }) => {
    await expect(
      page.getByText("Select an element to edit its properties."),
    ).toBeVisible();
  });

  test("canvas element is present and has nonzero size", async ({ page }) => {
    const canvas = page.getByTestId("fabric-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
    expect(box!.height).toBeGreaterThan(100);
  });
});

test.describe("Projects page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
    await mockContexts(page);
    await page.route("**/admin-api/groups/**/subgroups", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { subgroups: [] } }),
      }),
    );
    await page.route("**/admin-api/groups/**/contexts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { contexts: [] } }),
      }),
    );
    await page.goto("/teams/team-1/projects");
  });

  test("shows empty state", async ({ page }) => {
    await expect(page.getByTestId("empty-projects")).toBeVisible({ timeout: 5000 });
  });

  test("Invitations tab is visible", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Invitations" })).toBeVisible({ timeout: 5000 });
  });

  test("switching to Invitations tab shows generate button", async ({ page }) => {
    await page.getByRole("button", { name: "Invitations" }).click();
    await expect(page.getByTestId("generate-invite")).toBeVisible();
  });

  test("shows projects when API returns them", async ({ page }) => {
    await page.route("**/admin-api/groups/**/subgroups", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { subgroups: [{ groupId: "sg-1", alias: "My Design" }] } }),
      }),
    );
    await page.route("**/admin-api/groups/**/contexts", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            contexts: [
              { contextId: "ctx-1", name: "My Design" },
            ],
          },
        }),
      }),
    );
    await page.reload();
    await expect(page.getByTestId("project-card-ctx-1")).toBeVisible({ timeout: 5000 });
    await expect(page.getByText("My Design")).toBeVisible();
  });
});
