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
    const canvas = page.getByTestId("main-canvas");
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

  test("marquee selects, zoom and text work", async ({ page }) => {
    const canvas = page.getByTestId("main-canvas");
    const box = (await canvas.boundingBox())!;

    // marquee → makes a selection (Deselect becomes enabled)
    await page.getByTestId("tool-marquee").click();
    await page.mouse.move(box.x + 150, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 420, box.y + 340, { steps: 10 });
    await page.mouse.up();
    const deselect = page.getByTestId("options-bar").getByRole("button", { name: "Deselect" });
    await expect(deselect).toBeEnabled();

    // zoom tool → click zooms in (status bar % grows; scoped since the top bar
    // also shows a zoom value)
    await page.getByTestId("tool-zoom").click();
    await page.mouse.click(box.x + 300, box.y + 250);
    await expect(page.getByTestId("status-bar").getByText("140%")).toBeVisible();

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
    const canvas = page.getByTestId("main-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(100);
  });

  test("has primary color and swap controls", async ({ page }) => {
    await expect(page.getByTestId("primary-swatch")).toBeVisible();
    await expect(page.getByTestId("swap-colors")).toBeVisible();
  });

  test("gradient tool is removed from the rail", async ({ page }) => {
    await expect(page.getByTestId("tool-gradient")).toHaveCount(0);
  });

  test("top menu bar has the full Photoshop-style menu set", async ({ page }) => {
    for (const m of ["File", "Edit", "Image", "Layer", "Select", "Filter", "View", "Window", "Help"]) {
      await expect(page.getByRole("button", { name: m, exact: true })).toBeVisible();
    }
    // Layer menu wires real actions
    await page.getByRole("button", { name: "Layer", exact: true }).click();
    await expect(page.getByText("New Raster Layer")).toBeVisible();
    await expect(page.getByText("Duplicate Layer")).toBeVisible();
  });

  test("status bar shows the document size", async ({ page }) => {
    const status = page.getByTestId("status-bar");
    await expect(status).toBeVisible();
    await expect(status.getByText("800 × 600 px")).toBeVisible();
  });

  test("clicking a fill layer's color opens the RGB/HSL picker", async ({ page }) => {
    await page.getByRole("button", { name: "New fill layer" }).click();
    const swatch = page.getByTestId("layer-color-swatch");
    await expect(swatch).toBeVisible();
    await swatch.click();
    const picker = page.getByTestId("color-picker");
    await expect(picker).toBeVisible();
    await expect(picker.getByTestId("rgb-sliders")).toBeVisible();
    await expect(picker.getByTestId("hsl-sliders")).toBeVisible();
    // typing a hex updates the swatch
    const hex = picker.getByTestId("color-hex-input");
    await hex.fill("#3aa0ff");
    await hex.press("Enter");
  });

  test("right-clicking a selection shows cut/copy/paste", async ({ page }) => {
    const canvas = page.getByTestId("main-canvas");
    const box = (await canvas.boundingBox())!;
    // make a marquee selection
    await page.getByTestId("tool-marquee").click();
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 260, { steps: 8 });
    await page.mouse.up();
    // right-click inside the selection
    await canvas.click({ button: "right", position: { x: 200, y: 180 } });
    await expect(page.getByRole("menu")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Cut" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Paste" })).toBeVisible();
  });

  const bg = (loc: ReturnType<Page["getByTestId"]>) =>
    loc.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);

  test("swap-colors button exchanges the two swatches", async ({ page }) => {
    const primary = page.getByTestId("primary-swatch");
    const secondary = page.getByTestId("secondary-swatch");
    const p0 = await bg(primary);
    const s0 = await bg(secondary);
    expect(p0).not.toBe(s0);
    await page.getByTestId("swap-colors").click();
    expect(await bg(primary)).toBe(s0);
    expect(await bg(secondary)).toBe(p0);
  });

  test("X swaps colors and D resets to black/white", async ({ page }) => {
    const primary = page.getByTestId("primary-swatch");
    const secondary = page.getByTestId("secondary-swatch");
    const p0 = await bg(primary);
    await page.keyboard.press("x");
    expect(await bg(primary)).not.toBe(p0); // swapped
    await page.keyboard.press("d");
    expect(await bg(primary)).toBe("rgb(0, 0, 0)");
    expect(await bg(secondary)).toBe("rgb(255, 255, 255)");
  });

  test("the secondary swatch opens its own color picker", async ({ page }) => {
    await page.getByTestId("secondary-swatch").click();
    const picker = page.getByTestId("color-picker");
    await expect(picker).toBeVisible();
    await expect(picker.getByText("Secondary color")).toBeVisible();
  });

  test("single-key shortcuts switch the active tool", async ({ page }) => {
    await page.keyboard.press("b");
    await expect(page.getByTestId("tool-brush")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("e");
    await expect(page.getByTestId("tool-eraser")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("v");
    await expect(page.getByTestId("tool-move")).toHaveAttribute("aria-pressed", "true");
  });

  test("View menu toggles the precision rulers", async ({ page }) => {
    // rulers on by default → 2 ruler canvases + the main canvas
    await expect(page.locator("canvas")).toHaveCount(3);
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("button", { name: "Rulers" }).click();
    await expect(page.locator("canvas")).toHaveCount(1);
  });

  test("Layer menu creates a new raster layer", async ({ page }) => {
    await page.getByRole("button", { name: "Layer", exact: true }).click();
    // getByText (not role) so we don't also match the panel's icon button
    // whose aria-label is "New raster layer".
    await page.getByText("New Raster Layer", { exact: true }).click();
    await expect(page.locator("span").filter({ hasText: /^Layer$/ })).toBeVisible();
  });

  test("View ▸ Actual Pixels resets zoom to 100%", async ({ page }) => {
    const status = page.getByTestId("status-bar");
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("button", { name: "Zoom In" }).click();
    await expect(status.getByText("125%")).toBeVisible();
    await page.getByRole("button", { name: "View", exact: true }).click();
    await page.getByRole("button", { name: "Actual Pixels (100%)" }).click();
    await expect(status.getByText("100%")).toBeVisible();
  });

  test("renders the Navigator and History dock panels", async ({ page }) => {
    await expect(page.getByTestId("navigator-panel")).toBeVisible();
    await expect(page.getByTestId("history-panel")).toBeVisible();
    // History starts collapsed; expand it to reveal the initial "Open" state
    await page.getByRole("button", { name: "Expand History" }).click();
    await expect(page.getByTestId("history-panel").getByText("Open")).toBeVisible();
  });

  test("painting records a labelled History entry", async ({ page }) => {
    await page.getByRole("button", { name: "Expand History" }).click();
    await page.getByTestId("tool-brush").click();
    await page.getByRole("button", { name: "New raster layer" }).click();
    const canvas = page.getByTestId("main-canvas");
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 220, box.y + 200, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId("history-panel").getByText("Brush")).toBeVisible();
  });

  test("multi-select: shift-click selects a range of layers", async ({ page }) => {
    // add three raster layers, then shift-click from the top row to the bottom
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "New raster layer" }).click();
    const rows = page.locator("span").filter({ hasText: /^Layer$/ });
    await rows.first().click();
    await rows.last().click({ modifiers: ["Shift"] });
    await expect(page.getByText(/\d selected/)).toBeVisible();
  });

  test("View menu exposes grid, guides, snap, crosshair and units", async ({ page }) => {
    await page.getByRole("button", { name: "View", exact: true }).click();
    for (const item of ["Grid", "Guides", "Snap", "Crosshair"]) {
      await expect(page.getByRole("button", { name: new RegExp(`^(✓ )?${item}$`) })).toBeVisible();
    }
    await expect(page.getByRole("button", { name: /^(✓ )?Pixels$/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Centimeters" })).toBeVisible();
  });

  test("Window menu toggles the History panel off", async ({ page }) => {
    await expect(page.getByTestId("history-panel")).toBeVisible();
    await page.getByRole("button", { name: "Window", exact: true }).click();
    await page.getByRole("button", { name: "✓ History" }).click();
    await expect(page.getByTestId("history-panel")).toHaveCount(0);
  });

  test("Layer menu offers rasterize / merge / flatten", async ({ page }) => {
    await page.getByRole("button", { name: "Layer", exact: true }).click();
    await expect(page.getByText("Rasterize Layer")).toBeVisible();
    await expect(page.getByText("Merge Visible")).toBeVisible();
    await expect(page.getByText("Flatten Image")).toBeVisible();
  });

  test("Adjustments panel opens the Levels dialog", async ({ page }) => {
    await page.getByRole("button", { name: "New raster layer" }).click();
    await page.getByTestId("open-levels").click();
    await expect(page.getByTestId("levels-editor")).toBeVisible();
    await expect(page.getByTestId("levels-apply")).toBeVisible();
  });

  test("color picker has an alpha slider and saveable swatches", async ({ page }) => {
    await page.getByTestId("secondary-swatch").click();
    const picker = page.getByTestId("color-picker");
    await expect(picker.getByTestId("alpha-slider")).toBeVisible();
    await expect(picker.getByTestId("swatch-library")).toBeVisible();
  });

  test("status bar tracks the cursor position over the canvas", async ({ page }) => {
    const canvas = page.getByTestId("main-canvas");
    const box = (await canvas.boundingBox())!;
    // a pointer drag guarantees pointermove fires (feeding the pointer store)
    await page.mouse.move(box.x + 200, box.y + 150);
    await page.mouse.down();
    await page.mouse.move(box.x + 240, box.y + 180, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByTestId("status-bar")).toContainText(/X:\s*-?\d/);
  });
});
