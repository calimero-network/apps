import { test, expect } from "@playwright/test";
import { callsTo, openEditor, waitForCalls, type RpcRecord } from "./support/mocks";

// The showcase gallery, in a real browser: the cards render their own previews
// through the compositor, opening one writes the whole document to the node, and a
// `?showcase=` deep link populates a fresh project.

const PROJECT_IDS = ["aurora", "ridge", "bauhaus", "transform-lab"];

test.describe("Showcase gallery", () => {
  let log: RpcRecord[];

  test.beforeEach(async ({ page }) => {
    log = await openEditor(page);
  });

  test("opens from the File menu", async ({ page }) => {
    await page.getByRole("button", { name: "File" }).click();
    await page.getByTestId("menu-open-showcase").click();
    await expect(page.getByTestId("showcase-picker")).toBeVisible();
  });

  test("lists every bundled project with its metadata", async ({ page }) => {
    await page.getByRole("button", { name: "File" }).click();
    await page.getByTestId("menu-open-showcase").click();
    for (const id of PROJECT_IDS) {
      const card = page.getByTestId(`showcase-card-${id}`);
      await expect(card).toBeVisible();
      await expect(card).toContainText(/\d+ × \d+/);
      await expect(card).toContainText(/\d+ layers/);
      await expect(card).toContainText(/\d+ folders/);
    }
  });

  test("renders a real preview for each card, not a placeholder", async ({ page }) => {
    await page.getByRole("button", { name: "File" }).click();
    await page.getByTestId("menu-open-showcase").click();
    for (const id of PROJECT_IDS) {
      const img = page.getByTestId(`showcase-thumb-${id}`).locator("img");
      await expect(img).toBeVisible({ timeout: 15_000 });
      // A PNG that actually decoded has a natural size; a broken one is 0×0.
      const width = await img.evaluate((el) => (el as HTMLImageElement).naturalWidth);
      expect(width).toBeGreaterThan(50);
    }
  });

  test("closes without touching the document", async ({ page }) => {
    await page.getByRole("button", { name: "File" }).click();
    await page.getByTestId("menu-open-showcase").click();
    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("showcase-picker")).toHaveCount(0);
    expect(callsTo(log, "add_layer")).toHaveLength(0);
  });

  test("opening one builds the whole document on the node", async ({ page }) => {
    await page.getByRole("button", { name: "File" }).click();
    await page.getByTestId("menu-open-showcase").click();
    await page.getByTestId("showcase-open-transform-lab").click();

    // The canvas is resized to the project's own dimensions…
    await waitForCalls(log, "update_document");
    const doc = callsTo(log, "update_document")[0].args;
    expect(doc).toMatchObject({ width: 1680, height: 1000 });

    // …every layer is added…
    await waitForCalls(log, "add_layer", 20, 30_000);
    // …the folder structure is applied in one call…
    const moves = await waitForCalls(log, "move_layers", 1, 30_000);
    expect((moves[0].args.moves as unknown[]).length).toBeGreaterThan(15);
    // …and pixels are uploaded per painted layer.
    await waitForCalls(log, "update_layer_content", 15, 30_000);

    // The panel now shows folders, and the picker has closed.
    await expect(page.getByTestId("showcase-picker")).toHaveCount(0);
    await expect(page.locator("[data-testid^='layer-row-'][data-kind='group']").first()).toBeVisible();
    await expect(page.getByTestId("status-bar")).toContainText("1680 × 1000 px");
  });

  test("the loaded document really is nested and transformed", async ({ page }) => {
    await page.getByRole("button", { name: "File" }).click();
    await page.getByTestId("menu-open-showcase").click();
    await page.getByTestId("showcase-open-transform-lab").click();
    await waitForCalls(log, "move_layers", 1, 30_000);

    // Nested folders: Specimens ▸ Row 1 / Row 2 means depths 0, 1 and 2 exist.
    const depths = await page.locator("[data-testid^='layer-row-']")
      .evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-depth")))].sort());
    expect(depths).toContain("0");
    expect(depths).toContain("1");
    expect(depths).toContain("2");

    // Selecting a warped tile shows its warp in the Transform panel (which ships
    // collapsed, so open it first).
    await page.locator("[data-testid^='layer-row-']").filter({ hasText: "Tile 10" }).click();
    await page.getByRole("button", { name: "Expand Transform" }).click();
    const brx = await page.getByTestId("warp-br-x").inputValue();
    const bry = await page.getByTestId("warp-br-y").inputValue();
    expect(Number(brx) !== 0 || Number(bry) !== 0).toBe(true);
    expect(Number(await page.getByTestId("transform-skewx").inputValue())).toBe(10);
  });

  test("asks before replacing an occupied document", async ({ page }) => {
    await page.getByRole("button", { name: "New raster layer" }).click();
    await page.getByRole("button", { name: "File" }).click();
    await page.getByTestId("menu-open-showcase").click();

    // First click arms, second confirms — nothing is written in between.
    await page.getByTestId("showcase-open-bauhaus").click();
    await expect(page.getByTestId("showcase-confirm-bauhaus")).toBeVisible();
    expect(callsTo(log, "update_document")).toHaveLength(0);

    await page.getByTestId("showcase-confirm-bauhaus").click();
    await waitForCalls(log, "update_document", 1, 30_000);
    // the layer that was there is deleted as part of the load
    expect((await waitForCalls(log, "delete_layer", 1, 30_000)).length).toBeGreaterThanOrEqual(1);
  });

  test("loads straight into a blank document with no confirmation", async ({ page }) => {
    await page.getByRole("button", { name: "File" }).click();
    await page.getByTestId("menu-open-showcase").click();
    await page.getByTestId("showcase-open-ridge").click();
    // no "confirm" step for an empty canvas
    await expect(page.getByTestId("showcase-confirm-ridge")).toHaveCount(0);
    await waitForCalls(log, "update_document", 1, 30_000);
  });
});

test.describe("Showcase deep link", () => {
  test("?showcase= populates an empty project", async ({ page }) => {
    const log = await openEditor(page, { query: "?showcase=bauhaus" });
    await waitForCalls(log, "update_document", 1, 30_000);
    expect(callsTo(log, "update_document")[0].args).toMatchObject({ width: 1400, height: 1750 });
    await waitForCalls(log, "move_layers", 1, 30_000);
    await expect(page.locator("[data-testid^='layer-row-'][data-kind='group']").first()).toBeVisible();
  });

  test("an unknown id says so instead of loading nothing quietly", async ({ page }) => {
    await openEditor(page, { query: "?showcase=not-a-project" });
    await expect(page.getByText(/Unknown showcase/)).toBeVisible();
  });

  test("refuses to overwrite a document that already has layers", async ({ page }) => {
    const log = await openEditor(page, {
      query: "?showcase=aurora",
      layers: [{
        id: "existing", name: "My work", kind: "raster", parentId: null, layerIndex: 0,
        visible: true, locked: false, opacity: 100, blendMode: "normal",
        x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 100, scaleY: 100,
        adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 0, invert: false },
        createdBy: "me", createdAt: 1, updatedAt: 1,
      }],
    });
    await expect(page.getByText(/already has layers/)).toBeVisible();
    expect(callsTo(log, "update_document")).toHaveLength(0);
    expect(callsTo(log, "delete_layer")).toHaveLength(0);
  });
});

test.describe("Showcase starters on the projects page", () => {
  test("the New Project modal offers a blank canvas and every showcase", async ({ page }) => {
    await openEditor(page); // reuses the auth + route mocks
    await page.goto("/teams/team-1/projects");
    await page.getByTestId("open-create-modal").click();
    await expect(page.getByTestId("starter-blank")).toBeVisible();
    for (const id of PROJECT_IDS) {
      await expect(page.getByTestId(`starter-${id}`)).toBeVisible();
    }
  });

  test("picking a showcase locks the canvas size to it", async ({ page }) => {
    await openEditor(page);
    await page.goto("/teams/team-1/projects");
    await page.getByTestId("open-create-modal").click();
    await page.getByTestId("starter-ridge").click();
    await expect(page.getByText("set by the showcase")).toBeVisible();
    await expect(page.getByTestId("starter-ridge")).toContainText("1800 × 1200");
  });

  test("switching back to Blank restores the size presets", async ({ page }) => {
    await openEditor(page);
    await page.goto("/teams/team-1/projects");
    await page.getByTestId("open-create-modal").click();
    await page.getByTestId("starter-aurora").click();
    await page.getByTestId("starter-blank").click();
    await expect(page.getByText("set by the showcase")).toHaveCount(0);
    await expect(page.getByTestId("preset-1280x720")).toBeVisible();
  });
});
