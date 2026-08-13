import { test, expect, type Page } from "@playwright/test";
import { openEditor, waitForCalls, type RpcRecord } from "./support/mocks";

// Free transform in a real browser: the numeric panel, the canvas gizmo (scale,
// rotate, shear, warp pins) and the fact that all of them land on the contract's
// `update_transform` rather than silently staying local.

async function addLayer(page: Page) {
  await page.getByRole("button", { name: "New raster layer" }).click();
}

/** Expand the panel without requiring a selected layer. */
async function openTransformPanel2(page: Page) {
  const collapse = page.getByRole("button", { name: "Expand Transform" });
  if (await collapse.count() > 0) await collapse.click();
}

/** The Transform panel ships collapsed (five expanded panels would push Layers
 *  off the dock), so specs that read its controls open it first. */
async function openTransformPanel(page: Page) {
  const collapse = page.getByRole("button", { name: "Expand Transform" });
  if (await collapse.count() > 0) await collapse.click();
  await expect(page.getByTestId("transform-rotation")).toBeVisible();
}

/** The last update_transform call's args. */
async function lastTransform(log: RpcRecord[], count = 1) {
  const calls = await waitForCalls(log, "update_transform", count);
  return calls[calls.length - 1].args;
}

test.describe("Transform panel", () => {
  let log: RpcRecord[];

  test.beforeEach(async ({ page }) => {
    log = await openEditor(page);
    await addLayer(page);
    await openTransformPanel(page);
  });

  test("is in the right dock and lists the transform controls", async ({ page }) => {
    const panel = page.getByTestId("transform-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Transform", { exact: true })).toBeVisible();
    for (const id of [
      "transform-x", "transform-y", "transform-rotation",
      "transform-skewx", "transform-skewy", "flip-h", "flip-v",
      "warp-corners", "transform-reset", "transform-apply",
    ]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
  });

  test("does not offer a size control — the canvas handles own that", async ({ page }) => {
    const panel = page.getByTestId("transform-panel");
    await expect(panel.getByText("Width")).toHaveCount(0);
    await expect(panel.getByText("Height")).toHaveCount(0);
  });

  test("typing an angle persists it through update_transform", async ({ page }) => {
    await page.getByTestId("transform-rotation").fill("35");
    await page.getByTestId("transform-rotation").blur();
    expect(await lastTransform(log)).toMatchObject({ rotation: 35 });
  });

  test("the 90° buttons rotate both ways", async ({ page }) => {
    await page.getByTestId("rotate-cw").click();
    expect(await lastTransform(log)).toMatchObject({ rotation: 90 });
    await page.getByTestId("rotate-ccw").click();
    // back to 0 — and 0 is a value, not "unset"
    expect(await lastTransform(log, 2)).toMatchObject({ rotation: 0 });
  });

  test("shear sliders write skew_x / skew_y", async ({ page }) => {
    await page.getByTestId("transform-skewx").fill("25");
    await page.getByTestId("transform-skewx").blur();
    expect(await lastTransform(log)).toMatchObject({ skew_x: 25 });
    await page.getByTestId("transform-skewy").fill("-15");
    await page.getByTestId("transform-skewy").blur();
    expect(await lastTransform(log, 2)).toMatchObject({ skew_y: -15 });
  });

  test("both mirrors toggle and report their state", async ({ page }) => {
    await page.getByTestId("flip-h").click();
    expect(await lastTransform(log)).toMatchObject({ flip_h: true });
    await expect(page.getByTestId("flip-h")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("flip-v").click();
    expect(await lastTransform(log, 2)).toMatchObject({ flip_v: true });
  });

  test("a warp preset writes real corner offsets", async ({ page }) => {
    await page.getByTestId("warp-preset-perspective").click();
    const args = await lastTransform(log);
    expect(typeof args.warp).toBe("string");
    const corners = JSON.parse(args.warp as string) as Record<string, [number, number]>;
    expect(corners.tl[0]).toBeGreaterThan(0);
    expect(corners.tr[0]).toBeLessThan(0);
  });

  test("every preset is offered and each produces a different warp", async ({ page }) => {
    const seen = new Set<string>();
    for (const preset of ["perspective", "keystone", "fan", "twist"]) {
      await page.getByTestId(`warp-preset-${preset}`).click();
      const calls = await waitForCalls(log, "update_transform", seen.size + 1);
      seen.add(String(calls[calls.length - 1].args.warp));
    }
    expect(seen.size).toBe(4);
  });

  test("None clears the warp, and is only live once there is one", async ({ page }) => {
    await expect(page.getByTestId("warp-reset")).toBeDisabled();
    await page.getByTestId("warp-preset-twist").click();
    await expect(page.getByTestId("warp-reset")).toBeEnabled();
    await page.getByTestId("warp-reset").click();
    expect(await lastTransform(log, 2)).toMatchObject({ warp: "" });
  });

  test("a corner can be nudged numerically", async ({ page }) => {
    await page.getByTestId("warp-br-x").fill("40");
    await page.getByTestId("warp-br-x").blur();
    const corners = JSON.parse((await lastTransform(log)).warp as string) as Record<string, [number, number]>;
    expect(corners.br).toEqual([40, 0]);
  });

  test("Reset clears every transform field in one call", async ({ page }) => {
    await page.getByTestId("rotate-cw").click();
    await page.getByTestId("transform-reset").click();
    expect(await lastTransform(log, 2)).toMatchObject({
      rotation: 0, scale_x: 100, scale_y: 100, skew_x: 0, skew_y: 0,
      flip_h: false, flip_v: false, warp: "",
    });
  });

  test("the reported bounds grow when the layer is rotated", async ({ page }) => {
    const before = await page.getByTestId("transform-bounds").innerText();
    await page.getByTestId("transform-rotation").fill("45");
    await page.getByTestId("transform-rotation").blur();
    await expect(page.getByTestId("transform-bounds")).not.toHaveText(before);
  });

  test("the Window menu can hide it", async ({ page }) => {
    await page.getByRole("button", { name: "Window", exact: true }).click();
    await page.getByRole("button", { name: "✓ Transform" }).click();
    await expect(page.getByTestId("transform-panel")).toHaveCount(0);
  });

  test("it ships collapsed, so the Layers panel keeps the dock", async ({ page }) => {
    await openEditor(page); // a fresh editor, without the beforeEach's expansion
    await expect(page.getByTestId("transform-panel")).toBeVisible();
    await expect(page.getByTestId("transform-rotation")).toHaveCount(0);
    await expect(page.getByTestId("layers-list")).toBeVisible();
  });

  test("Edit ▸ Transform Numerically brings it back", async ({ page }) => {
    await page.getByRole("button", { name: "Window", exact: true }).click();
    await page.getByRole("button", { name: "✓ Transform" }).click();
    await expect(page.getByTestId("transform-panel")).toHaveCount(0);
    // Panel toggles deliberately leave the Window menu open (so you can flip
    // several), and it puts a full-viewport backdrop over everything — dismiss it
    // with a raw click before going near another menu.
    await page.mouse.click(600, 400);
    await expect(page.getByRole("button", { name: "✓ Layers" })).toHaveCount(0);
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByTestId("menu-show-transform-panel").click();
    await expect(page.getByTestId("transform-panel")).toBeVisible();
    // …opened, not merely present: a collapsed panel would be a dead end
    await expect(page.getByTestId("transform-rotation")).toBeVisible();
  });
});

test.describe("Transform tool on the canvas", () => {
  let log: RpcRecord[];

  test.beforeEach(async ({ page }) => {
    log = await openEditor(page);
    await addLayer(page);
    await openTransformPanel(page);
    await page.getByTestId("tool-transform").click();
  });

  test("the options bar offers Free and Warp modes", async ({ page }) => {
    const bar = page.getByTestId("options-bar");
    await expect(bar.getByText("Transform", { exact: true })).toBeVisible();
    await expect(page.getByTestId("transform-mode-free")).toBeVisible();
    await expect(page.getByTestId("transform-mode-warp")).toBeVisible();
  });

  test("warp mode shows a hint and the Free mode does not", async ({ page }) => {
    await expect(page.getByTestId("warp-hint")).toHaveCount(0);
    await page.getByTestId("transform-mode-warp").click();
    await expect(page.getByTestId("warp-hint")).toBeVisible();
    await page.getByTestId("transform-mode-free").click();
    await expect(page.getByTestId("warp-hint")).toHaveCount(0);
  });

  test("the panel's Pins button and the options bar agree", async ({ page }) => {
    await page.getByTestId("warp-mode-toggle").click();
    await expect(page.getByTestId("warp-hint")).toBeVisible();
    await expect(page.getByTestId("warp-mode-toggle")).toHaveAttribute("aria-pressed", "true");
  });

  test("dragging a corner handle scales the layer", async ({ page }) => {
    // The layer is document-sized (800×600) and the view opens at zoom 1, pan
    // (48,48) — so its TOP-LEFT handle is at canvas (48,48). The bottom-right one
    // would be at y=648, past the bottom of the visible canvas.
    const canvas = page.getByTestId("main-canvas");
    const box = (await canvas.boundingBox())!;
    const corner = { x: box.x + 48, y: box.y + 48 };

    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    await page.mouse.move(corner.x + 200, corner.y + 150, { steps: 10 });
    await page.mouse.up();

    const args = await lastTransform(log);
    expect(args.scale_x).not.toBeNull();
    expect(Number(args.scale_x)).toBeLessThan(100); // dragged inward → smaller
  });

  test("dragging the top knob rotates the layer", async ({ page }) => {
    const canvas = page.getByTestId("main-canvas");
    const box = (await canvas.boundingBox())!;
    // knob: 28px above the top edge midpoint (doc 400,0 → canvas +48 pan)
    const knob = { x: box.x + 48 + 400, y: box.y + 48 - 28 };
    await page.mouse.move(knob.x, knob.y);
    await page.mouse.down();
    await page.mouse.move(knob.x + 260, knob.y + 160, { steps: 12 });
    await page.mouse.up();

    const args = await lastTransform(log);
    expect(args.rotation).not.toBeNull();
    expect(Number(args.rotation)).not.toBe(0);
  });

  test("dragging an edge grip shears the layer", async ({ page }) => {
    const canvas = page.getByTestId("main-canvas");
    const box = (await canvas.boundingBox())!;
    const topMid = { x: box.x + 48 + 400, y: box.y + 48 };
    await page.mouse.move(topMid.x, topMid.y);
    await page.mouse.down();
    await page.mouse.move(topMid.x + 180, topMid.y, { steps: 10 });
    await page.mouse.up();

    const args = await lastTransform(log);
    expect(Number(args.skew_x)).not.toBe(0);
  });

  test("dragging a warp pin bends the layer", async ({ page }) => {
    await page.getByTestId("transform-mode-warp").click();
    const canvas = page.getByTestId("main-canvas");
    const box = (await canvas.boundingBox())!;
    const topLeft = { x: box.x + 48, y: box.y + 48 };
    await page.mouse.move(topLeft.x, topLeft.y);
    await page.mouse.down();
    await page.mouse.move(topLeft.x + 120, topLeft.y + 40, { steps: 10 });
    await page.mouse.up();

    const args = await lastTransform(log);
    const corners = JSON.parse(String(args.warp)) as Record<string, [number, number]>;
    expect(corners.tl[0]).toBeGreaterThan(50);
    expect(corners.tr).toEqual([0, 0]); // only the grabbed pin moved
  });

  test("the drag is undoable, and labelled", async ({ page }) => {
    await page.getByRole("button", { name: "Expand History" }).click();
    const canvas = page.getByTestId("main-canvas");
    const box = (await canvas.boundingBox())!;
    const knob = { x: box.x + 48 + 400, y: box.y + 48 - 28 };
    await page.mouse.move(knob.x, knob.y);
    await page.mouse.down();
    await page.mouse.move(knob.x + 120, knob.y + 90, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByTestId("history-panel").getByText("Rotate")).toBeVisible();
  });

  test("a viewer cannot transform anything", async ({ page }) => {
    await openEditor(page, { role: "viewer" });
    await openTransformPanel2(page);
    await expect(page.getByTestId("transform-panel").getByText("Select a layer")).toBeVisible();
  });
});
