import { test, expect, type Page } from "@playwright/test";

// Inject auth so we land directly in the editor (mirrors mero-design's harness).
async function injectAuth(page: Page) {
  await page.addInitScript(() => {
    // JWT payload {"sub":"test-identity"} — matches the member id in mockRpc
    localStorage.setItem("mero-tokens", JSON.stringify({
      access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LWlkZW50aXR5In0.sig",
      refresh_token: "fake-refresh",
      expires_at: Date.now() + 3600_000,
    }));
    localStorage.setItem("mero:node_url", "http://localhost:2460");
    localStorage.setItem("mero:application_id", "app-1");
  });
}

// MeroProvider gates isAuthenticated on a GET /admin-api/contexts probe.
function mockContexts(page: Page) {
  return page.route("**/admin-api/contexts", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { contexts: [] } }) }),
  );
}

function mockIdentities(page: Page) {
  return page.route("**/admin-api/contexts/**/identities-owned", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: ["test-identity"] }) }),
  );
}

function rpcBytes(value: unknown) {
  const bytes = Array.from(new TextEncoder().encode(JSON.stringify(value)));
  return JSON.stringify({ jsonrpc: "2.0", id: 1, result: { output: bytes, logs: [] } });
}

function mockRpc(page: Page) {
  return page.route("**/jsonrpc", (route) => {
    const body = route.request().postDataJSON() as { params?: { method?: string } };
    const method = body?.params?.method ?? "";
    const TEST_MEMBER = { id: "test-identity", username: "Tester", avatar: null, joinedAt: 1000 };
    let value: unknown = null;
    switch (method) {
      case "get_document":
        value = { name: "Test Project", description: "", width: 800, height: 600, background: "#00000000", layerCount: 0, memberCount: 1, owner: "test-identity" };
        break;
      case "get_layers": value = []; break;
      case "get_members": value = [TEST_MEMBER]; break;
      case "get_cursors": value = []; break;
      case "my_role": value = "admin"; break;
      default: value = null;
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: rpcBytes(value) });
  });
}

function mockSse(page: Page) {
  page.route("**/events**", (route) => route.abort());
  return page.route("**/sse**", (route) => route.abort());
}

test.describe("Editor", () => {
  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
    await mockContexts(page);
    await mockIdentities(page);
    await mockRpc(page);
    await mockSse(page);
    await page.goto("/teams/team-1/projects/project-1");
    await expect(page.getByTestId("toolbar")).toBeVisible({ timeout: 8000 });
  });

  test("renders the tool rail with core tools", async ({ page }) => {
    for (const tool of ["move", "brush", "eraser", "bucket", "eyedropper", "text", "transform"]) {
      await expect(page.getByTestId(`tool-${tool}`)).toBeVisible();
    }
  });

  test("shows the loaded document name in the top bar", async ({ page }) => {
    await expect(page.getByText("Test Project")).toBeVisible();
  });

  test("shows the admin role badge", async ({ page }) => {
    await expect(page.getByText("admin", { exact: true })).toBeVisible();
  });

  test("selecting the brush reveals brush controls", async ({ page }) => {
    await page.getByTestId("tool-brush").click();
    await expect(page.getByTestId("brush-controls")).toBeVisible();
    await expect(page.getByTestId("brush-size")).toBeVisible();
  });

  test("renders the Layers panel", async ({ page }) => {
    await expect(page.getByText("Layers", { exact: true })).toBeVisible();
  });

  test("renders the canvas surface with nonzero size", async ({ page }) => {
    const canvas = page.locator("canvas").first();
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
  });

  test("has primary color and swap controls", async ({ page }) => {
    await expect(page.getByTestId("primary-swatch")).toBeVisible();
    await expect(page.getByTestId("swap-colors")).toBeVisible();
  });
});
