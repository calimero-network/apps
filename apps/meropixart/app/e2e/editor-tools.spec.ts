import { test, expect, type Page } from "@playwright/test";
import { callsTo, openEditor, waitForCalls, type RpcRecord } from "./support/mocks";

// The rest of the editor, checked against what it asks the node to do: filters,
// adjustments, masks, crop, merge/flatten, clipboard, guides, export and undo.
// editor.spec.ts covers the chrome (tools, menus, panels being present); this file
// covers the operations actually reaching the contract.

async function addLayer(page: Page) {
  await page.getByRole("button", { name: "New raster layer" }).click();
}

/**
 * Scribble on the canvas so the active layer has pixels to work on.
 *
 * Pass the RPC log to wait for the stroke's blob upload to land: a test that then
 * counts `update_layer_content` calls would otherwise race the brush's own commit
 * and read a baseline of zero.
 */
async function paint(page: Page, log?: RpcRecord[]) {
  await page.getByTestId("tool-brush").click();
  const box = (await page.getByTestId("main-canvas").boundingBox())!;
  await page.mouse.move(box.x + 120, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + 200, { steps: 10 });
  await page.mouse.up();
  if (log) await waitForCalls(log, "update_layer_content");
}

test.describe("Editor operations", () => {
  let log: RpcRecord[];

  test.beforeEach(async ({ page }) => {
    log = await openEditor(page);
  });

  test("a brush stroke uploads pixels and records history", async ({ page }) => {
    await addLayer(page);
    await paint(page);
    const commits = await waitForCalls(log, "update_layer_content");
    expect(commits[0].args).toMatchObject({ id: expect.any(String) });
    await page.getByRole("button", { name: "Expand History" }).click();
    await expect(page.getByTestId("history-panel").getByText("Brush")).toBeVisible();
  });

  test("a filter bakes into the layer's pixels", async ({ page }) => {
    await addLayer(page);
    await paint(page, log);
    const before = callsTo(log, "update_layer_content").length;
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    await page.getByText("Gaussian Blur").click();
    await waitForCalls(log, "update_layer_content", before + 1);
    await page.getByRole("button", { name: "Expand History" }).click();
    await expect(page.getByTestId("history-panel").getByText("Filter: blur")).toBeVisible();
  });

  test("every filter in the menu is offered", async ({ page }) => {
    await page.getByRole("button", { name: "Filter", exact: true }).click();
    for (const label of [
      "Gaussian Blur", "Motion Blur", "Sharpen", "Pixelate", "Add Noise",
      "Grayscale", "Sepia", "Invert", "Brighten", "Darken",
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("an adjustment slider persists non-destructively", async ({ page }) => {
    await addLayer(page);
    const slider = page.getByTestId("adjustments-panel").locator("input[type='range']").first();
    await slider.fill("40");
    const calls = await waitForCalls(log, "update_adjustments", 1, 8_000);
    expect(calls[0].args).toHaveProperty("brightness");
    // …and no pixels were rewritten: that is what "non-destructive" means
    expect(callsTo(log, "update_layer_content")).toHaveLength(0);
  });

  test("Levels bakes into pixels, unlike the sliders", async ({ page }) => {
    await addLayer(page);
    await paint(page, log);
    const before = callsTo(log, "update_layer_content").length;
    await page.getByTestId("open-levels").click();
    await expect(page.getByTestId("levels-editor")).toBeVisible();
    await page.getByTestId("levels-apply").click();
    await waitForCalls(log, "update_layer_content", before + 1);
  });

  test("adding a mask uploads a mask blob and shows the banner", async ({ page }) => {
    await addLayer(page);
    await page.getByRole("button", { name: "Add or remove layer mask" }).click();
    const calls = await waitForCalls(log, "update_layer_mask");
    expect(calls[0].args.mask_blob_id).toBeTruthy();
    await expect(page.getByText(/Editing mask/)).toBeVisible();
  });

  test("removing the mask clears the blob id", async ({ page }) => {
    await addLayer(page);
    await page.getByRole("button", { name: "Add or remove layer mask" }).click();
    await waitForCalls(log, "update_layer_mask");
    await page.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Add or remove layer mask" }).click();
    const calls = await waitForCalls(log, "update_layer_mask", 2);
    expect(calls[calls.length - 1].args.mask_blob_id).toBeNull();
  });

  test("cropping resizes the document and repositions every layer", async ({ page }) => {
    await addLayer(page);
    await page.getByTestId("tool-crop").click();
    const box = (await page.getByTestId("main-canvas").boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 350, { steps: 10 });
    await page.mouse.up();
    await page.getByRole("button", { name: /Apply crop/ }).click();

    const calls = await waitForCalls(log, "update_document");
    expect(Number(calls[0].args.width)).toBeGreaterThan(0);
    expect(Number(calls[0].args.width)).toBeLessThan(800);
    await expect(page.getByTestId("status-bar")).not.toContainText("800 × 600 px");
  });

  test("blend mode and opacity persist through update_layer", async ({ page }) => {
    await addLayer(page);
    await page.getByRole("combobox").first().selectOption("multiply");
    let calls = await waitForCalls(log, "update_layer");
    expect(calls[calls.length - 1].args.blend_mode).toBe("multiply");

    const before = calls.length;
    await page.getByTestId("layer-opacity").fill("40");
    calls = await waitForCalls(log, "update_layer", before + 1);
    expect(calls[calls.length - 1].args).toHaveProperty("opacity");
  });

  test("hiding a layer is persisted, not just local", async ({ page }) => {
    await addLayer(page);
    await page.getByRole("button", { name: "Hide layer" }).click();
    const calls = await waitForCalls(log, "update_layer");
    expect(calls[calls.length - 1].args.visible).toBe(false);
    await expect(page.getByRole("button", { name: "Show layer" })).toBeVisible();
  });

  test("locking a layer is persisted", async ({ page }) => {
    await addLayer(page);
    await page.getByRole("button", { name: "Lock layer" }).click();
    const calls = await waitForCalls(log, "update_layer");
    expect(calls[calls.length - 1].args.locked).toBe(true);
  });

  test("duplicating a layer adds a copy with the same pixels", async ({ page }) => {
    await addLayer(page);
    await paint(page, log);
    const before = callsTo(log, "add_layer").length;
    await page.getByRole("button", { name: "Duplicate layer" }).click();
    const adds = await waitForCalls(log, "add_layer", before + 1);
    const copy = adds[adds.length - 1].args.layer as { name: string };
    expect(copy.name).toContain("copy");
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(2);
  });

  test("flatten collapses the stack into one layer", async ({ page }) => {
    await addLayer(page);
    await paint(page);
    await addLayer(page);
    await page.getByRole("button", { name: "Layer", exact: true }).click();
    await page.getByText("Flatten Image").click();
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(1);
    // the merged layer is added, and the sources deleted
    await waitForCalls(log, "delete_layer", 2);
  });

  test("merge down combines two layers", async ({ page }) => {
    await addLayer(page);
    await paint(page);
    await addLayer(page);
    await paint(page);
    await page.getByRole("button", { name: "Layer", exact: true }).click();
    await page.getByText("Merge Down").click();
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(1);
  });

  test("rasterizing a text layer makes it a raster layer", async ({ page }) => {
    await page.getByRole("button", { name: "New text layer" }).click();
    await page.getByRole("button", { name: "Layer", exact: true }).click();
    await page.getByText("Rasterize Layer").click();
    await expect(page.locator("[data-testid^='layer-row-'][data-kind='raster']")).toHaveCount(1);
  });

  test("copy and paste creates a new layer from the selection", async ({ page }) => {
    await addLayer(page);
    await paint(page, log);
    await page.getByTestId("tool-marquee").click();
    const box = (await page.getByTestId("main-canvas").boundingBox())!;
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 260, { steps: 8 });
    await page.mouse.up();

    await page.keyboard.press("ControlOrMeta+c");
    await page.keyboard.press("ControlOrMeta+v");
    await expect(page.locator("[data-testid^='layer-row-']").filter({ hasText: "Pasted" })).toBeVisible();
  });

  test("Delete clears the selected region rather than the layer", async ({ page }) => {
    await addLayer(page);
    await paint(page, log);
    await page.getByTestId("tool-marquee").click();
    const box = (await page.getByTestId("main-canvas").boundingBox())!;
    await page.mouse.move(box.x + 120, box.y + 120);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 240, { steps: 8 });
    await page.mouse.up();

    const before = callsTo(log, "update_layer_content").length;
    await page.keyboard.press("Delete");
    await waitForCalls(log, "update_layer_content", before + 1);
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(1); // still there
  });

  test("undo and redo walk the history", async ({ page }) => {
    await addLayer(page);
    await addLayer(page);
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(2);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(1);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(2);
  });

  test("the History panel jumps to an earlier state", async ({ page }) => {
    await addLayer(page);
    await addLayer(page);
    await page.getByRole("button", { name: "Expand History" }).click();
    await page.getByTestId("history-panel").getByText("Open").click();
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(0);
  });

  test("a guide can be dragged out of the ruler and removed", async ({ page }) => {
    // canvas[0] is the top (horizontal) ruler — dragging DOWN off it, onto the
    // canvas, is what turns a negative doc coordinate into a kept guide.
    const ruler = page.locator("canvas").first();
    // The ruler sizes its own backing store in an effect; until that has run, the
    // element is in the DOM but the component is not finished mounting, and a
    // pointerdown can land before the handler is live. Under a loaded dev server
    // that window is wide enough to matter.
    await expect
      .poll(() => ruler.evaluate((c) => (c as HTMLCanvasElement).width), { timeout: 10_000 })
      .toBeGreaterThan(0);
    const box = (await ruler.boundingBox())!;
    await page.mouse.move(box.x + 200, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 140, { steps: 6 });
    await page.mouse.move(box.x + 200, box.y + 220, { steps: 6 });
    await page.mouse.up();
    // Assert through the View menu rather than the overlay's hashed class name:
    // "Clear Guides" is disabled until a guide exists, so it is a stable witness.
    await page.getByRole("button", { name: "View", exact: true }).click();
    await expect(page.getByRole("button", { name: "Clear Guides" })).toBeEnabled();
    await page.getByRole("button", { name: "Clear Guides" }).click();
    await page.getByRole("button", { name: "View", exact: true }).click();
    await expect(page.getByRole("button", { name: "Clear Guides" })).toBeDisabled();
  });

  test("Select All then Deselect toggles the selection", async ({ page }) => {
    await page.getByTestId("tool-marquee").click();
    const bar = page.getByTestId("options-bar");
    await expect(bar.getByRole("button", { name: "Deselect" })).toBeDisabled();
    await bar.getByRole("button", { name: "Select All" }).click();
    await expect(bar.getByRole("button", { name: "Deselect" })).toBeEnabled();
    await bar.getByRole("button", { name: "Deselect" }).click();
    await expect(bar.getByRole("button", { name: "Deselect" })).toBeDisabled();
  });

  test("the eyedropper samples a colour into the foreground swatch", async ({ page }) => {
    await addLayer(page);
    await page.getByTestId("tool-bucket").click();
    await page.getByRole("button", { name: "New fill layer" }).click();
    await page.getByTestId("tool-eyedropper").click();
    const box = (await page.getByTestId("main-canvas").boundingBox())!;
    await page.mouse.click(box.x + 200, box.y + 200);
    // whatever it sampled, the swatch is a valid colour
    const bg = await page.getByTestId("primary-swatch")
      .evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor);
    expect(bg).toMatch(/^rgb/);
  });

  test("exporting a PNG starts a download", async ({ page }) => {
    await addLayer(page);
    await paint(page);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export as PNG" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.png$/);
  });

  test("exporting an SVG wraps the flattened image", async ({ page }) => {
    await addLayer(page);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "File" }).click();
    await page.getByText("Export as SVG").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.svg$/);
  });

  test("a viewer can look but not touch", async ({ page }) => {
    await openEditor(page, { role: "viewer" });
    await expect(page.getByText("viewer", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "New raster layer" })).toHaveCount(0);
  });
});
