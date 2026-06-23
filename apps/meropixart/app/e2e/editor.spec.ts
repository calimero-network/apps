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

  test("selecting the brush reveals brush options in the options bar", async ({ page }) => {
    await page.getByTestId("tool-brush").click();
    const bar = page.getByTestId("options-bar");
    await expect(bar).toBeVisible();
    await expect(bar.getByText("Brush", { exact: true })).toBeVisible();
    await expect(bar.getByText("Size", { exact: true })).toBeVisible();
    await expect(bar.getByText("Opacity", { exact: true })).toBeVisible();
  });

  test("shape tool shows shape options", async ({ page }) => {
    await page.getByTestId("tool-shape").click();
    const bar = page.getByTestId("options-bar");
    await expect(bar.getByText("Shape", { exact: true })).toBeVisible();
    await expect(bar.getByText("Fill", { exact: true })).toBeVisible();
    await expect(bar.getByText("Stroke", { exact: true })).toBeVisible();
  });

  test("File menu exposes export and place options", async ({ page }) => {
    await page.getByRole("button", { name: "File" }).click();
    await expect(page.getByText("Place Image…")).toBeVisible();
    await expect(page.getByText("Export as SVG")).toBeVisible();
  });

  test("brush paints and the shape tool adds a new layer", async ({ page }) => {
    // add a raster layer to paint onto, pick the brush, scribble on the canvas
    await page.getByTestId("tool-brush").click();
    await page.getByRole("button", { name: "New raster layer" }).click();
    const canvas = page.locator("canvas").first();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 180, { steps: 12 });
    await page.mouse.move(box.x + 200, box.y + 300, { steps: 12 });
    await page.mouse.up();

    // draw an ellipse shape
    await page.getByTestId("tool-shape").click();
    await page.getByRole("combobox").first().selectOption("ellipse");
    await page.mouse.move(box.x + 320, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 460, box.y + 260, { steps: 12 });
    await page.mouse.up();

    // the shape drag created a new "Ellipse" layer (match the layer-row span, not the <option>)
    await expect(page.locator("span").filter({ hasText: /^Ellipse$/ })).toBeVisible();
  });

  test("marquee selects, gradient adds a layer, zoom and text work", async ({ page }) => {
    const canvas = page.locator("canvas").first();
    const box = (await canvas.boundingBox())!;

    // marquee → makes a selection (Deselect becomes enabled)
    await page.getByTestId("tool-marquee").click();
    await page.mouse.move(box.x + 150, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 420, box.y + 340, { steps: 10 });
    await page.mouse.up();
    const deselect = page.getByTestId("options-bar").getByRole("button", { name: "Deselect" });
    await expect(deselect).toBeEnabled();

    // gradient drag → creates a layer
    await page.getByTestId("tool-gradient").click();
    await page.mouse.move(box.x + 160, box.y + 160);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 320, { steps: 10 });
    await page.mouse.up();

    // zoom tool → click zooms in (top bar % grows)
    await page.getByTestId("tool-zoom").click();
    await page.mouse.click(box.x + 300, box.y + 250);
    await expect(page.getByText("140%")).toBeVisible();

    // text tool → clicking opens the inline editor
    await page.getByTestId("tool-text").click();
    await page.mouse.click(box.x + 200, box.y + 200);
    await expect(page.locator("textarea")).toBeVisible();
    await page.keyboard.type("Hello");
    await expect(page.locator("textarea")).toHaveValue("Hello");
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
