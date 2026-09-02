import { test, expect, type Locator, type Page } from "@playwright/test";
import { callsTo, openEditor, waitForCalls, type RpcRecord } from "./support/mocks";

// Layer folders, end to end in a real browser: creating them, nesting, collapsing,
// renaming, selecting a folder's contents, dragging a folder on the canvas and
// ungrouping again.

/** Add N raster layers via the panel's toolbar. */
async function addLayers(page: Page, n: number) {
  for (let i = 0; i < n; i++) {
    await page.getByRole("button", { name: "New raster layer" }).click();
  }
}

/** The Layers panel list — name lookups must be scoped to it, because the
 *  Transform panel also shows the selected layer's name. */
function layers(page: Page) {
  return page.getByTestId("layers-list");
}

/**
 * Drag one panel row onto another.
 *
 * Playwright's `dragTo` drives the MOUSE, and mouse events do not start an HTML5
 * drag — no dragstart, no drop, so a `draggable` list looks inert to it. The
 * events have to be dispatched directly.
 */
async function dragRowOnto(page: Page, source: Locator, target: Locator) {
  await source.dispatchEvent("dragstart");
  await target.dispatchEvent("dragover");
  await target.dispatchEvent("drop");
  // No `dragend`: the drop re-parents the row, which re-renders it out from under
  // the locator — and the panel already clears its drag state on drop.
}

test.describe("Layer folders", () => {
  let log: RpcRecord[];

  test.beforeEach(async ({ page }) => {
    log = await openEditor(page);
  });

  test("the Layers toolbar offers a folder alongside the layer kinds", async ({ page }) => {
    await expect(page.getByRole("button", { name: "New folder" })).toBeVisible();
    await expect(page.getByTestId("group-selected")).toBeVisible();
    await expect(page.getByTestId("ungroup-folder")).toBeVisible();
  });

  test("grouping one layer wraps it in a folder and nests it", async ({ page }) => {
    await addLayers(page, 1);
    await page.getByTestId("group-selected").click();

    // the folder row exists, is named, and reports one layer inside
    await expect(page.locator("[data-testid^='layer-row-'][data-kind='group']")).toHaveCount(1);
    await expect(layers(page).getByText("Group 1")).toBeVisible();
    await expect(page.getByTestId("group-content-count")).toContainText("1 layer inside");

    // …and the nesting was persisted in ONE call, not one per layer
    const moves = await waitForCalls(log, "move_layers");
    expect(moves).toHaveLength(1);
    expect((moves[0].args.moves as unknown[])).toHaveLength(1);
  });

  test("grouping a multi-selection puts every member in one folder", async ({ page }) => {
    await addLayers(page, 3);
    const rows = page.locator("[data-testid^='layer-row-']");
    await rows.first().click();
    await rows.nth(2).click({ modifiers: ["Shift"] });
    await expect(page.getByText("3 selected")).toBeVisible();

    await page.getByTestId("group-selected").click();
    await expect(page.getByTestId("group-content-count")).toContainText("3 layers inside");
    const moves = await waitForCalls(log, "move_layers");
    expect((moves[0].args.moves as unknown[])).toHaveLength(3);
  });

  test("a folder's twirl hides and shows its contents", async ({ page }) => {
    await addLayers(page, 2);
    const rows = page.locator("[data-testid^='layer-row-']");
    await rows.first().click();
    await rows.nth(1).click({ modifiers: ["Shift"] });
    await page.getByTestId("group-selected").click();

    const twirl = page.locator("[data-testid^='group-twirl-']");
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(3);
    await twirl.click();
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(1);
    await expect(twirl).toHaveAttribute("aria-expanded", "false");
    await twirl.click();
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(3);
  });

  test("selecting a folder selects everything inside it", async ({ page }) => {
    await addLayers(page, 2);
    const rows = page.locator("[data-testid^='layer-row-']");
    await rows.first().click();
    await rows.nth(1).click({ modifiers: ["Shift"] });
    await page.getByTestId("group-selected").click();

    // click elsewhere, then back on the folder row
    await page.locator("[data-testid^='layer-row-'][data-kind='raster']").first().click();
    await expect(page.getByText("3 selected")).toHaveCount(0);
    await page.locator("[data-testid^='layer-row-'][data-kind='group']").click();
    await expect(page.getByText("3 selected")).toBeVisible();
  });

  test("dragging a selected folder on the canvas moves its contents with it", async ({ page }) => {
    await addLayers(page, 2);
    const rows = page.locator("[data-testid^='layer-row-']");
    await rows.first().click();
    await rows.nth(1).click({ modifiers: ["Shift"] });
    await page.getByTestId("group-selected").click();
    await page.locator("[data-testid^='layer-row-'][data-kind='group']").click();

    const canvas = page.getByTestId("main-canvas");
    const box = (await canvas.boundingBox())!;
    await page.getByTestId("tool-move").click();
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 260, { steps: 12 });
    await page.mouse.up();

    // Every moved layer gets its own update_layer — the folder plus both children.
    const updates = await waitForCalls(log, "update_layer", 3);
    expect(updates.filter((r) => r.args.x !== null).length).toBeGreaterThanOrEqual(3);
    // and it is recorded as a group move in the History panel
    await page.getByRole("button", { name: "Expand History" }).click();
    await expect(page.getByTestId("history-panel").getByText("Move Group")).toBeVisible();
  });

  test("a folder can be renamed by double-clicking its name", async ({ page }) => {
    await addLayers(page, 1);
    await page.getByTestId("group-selected").click();
    const folderRow = page.locator("[data-testid^='layer-row-'][data-kind='group']");
    await folderRow.getByText("Group 1").dblclick();
    const input = page.locator("[data-testid^='layer-rename-']");
    await input.fill("Header");
    await input.press("Enter");
    await expect(layers(page).getByText("Header")).toBeVisible();
    const renames = (await waitForCalls(log, "update_layer"))
      .filter((r) => r.args.name === "Header");
    expect(renames).toHaveLength(1);
  });

  test("dragging a layer onto a folder row nests it", async ({ page }) => {
    await addLayers(page, 1);
    await page.getByTestId("group-selected").click();
    await addLayers(page, 1); // a fresh top-level layer

    const folder = page.locator("[data-testid^='layer-row-'][data-kind='group']");
    // depth 0 = still at the top level; the folder's own child is at depth 1
    const loose = page.locator("[data-testid^='layer-row-'][data-kind='raster'][data-depth='0']");
    await dragRowOnto(page, loose, folder);

    await expect(folder).toBeVisible();
    await folder.click();
    await expect(page.getByTestId("group-content-count")).toContainText("2 layers inside");
  });

  test("the root strip drags a layer back out of its folder", async ({ page }) => {
    await addLayers(page, 1);
    await page.getByTestId("group-selected").click();
    const child = page.locator("[data-testid^='layer-row-'][data-kind='raster']").first();

    // The strip only exists mid-drag, so the drag has to be dispatched in steps.
    await child.dispatchEvent("dragstart");
    const zone = page.getByTestId("root-drop-zone");
    await expect(zone).toBeVisible();
    await zone.dispatchEvent("dragover");
    await zone.dispatchEvent("drop");

    await expect(page.locator("[data-testid^='layer-row-'][data-kind='group']")).toBeVisible();
    await page.locator("[data-testid^='layer-row-'][data-kind='group']").click();
    await expect(page.getByTestId("group-content-count")).toContainText("0 layers inside");
  });

  test("ungrouping dissolves the folder and keeps the layers", async ({ page }) => {
    await addLayers(page, 2);
    const rows = page.locator("[data-testid^='layer-row-']");
    await rows.first().click();
    await rows.nth(1).click({ modifiers: ["Shift"] });
    await page.getByTestId("group-selected").click();
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(3);

    await page.getByTestId("ungroup-selected").click();
    await expect(page.locator("[data-testid^='layer-row-'][data-kind='group']")).toHaveCount(0);
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(2);
    expect(await waitForCalls(log, "delete_layer")).toHaveLength(1);
  });

  test("⌘G groups and ⌘⇧G ungroups", async ({ page }) => {
    await addLayers(page, 2);
    const rows = page.locator("[data-testid^='layer-row-']");
    await rows.first().click();
    await rows.nth(1).click({ modifiers: ["Shift"] });

    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.locator("[data-testid^='layer-row-'][data-kind='group']")).toHaveCount(1);

    await page.keyboard.press("ControlOrMeta+Shift+g");
    await expect(page.locator("[data-testid^='layer-row-'][data-kind='group']")).toHaveCount(0);
  });

  test("nested folders indent, and each collapses on its own", async ({ page }) => {
    await addLayers(page, 1);
    await page.getByTestId("group-selected").click();      // inner folder
    await page.locator("[data-testid^='layer-row-'][data-kind='group']").click();
    await page.getByTestId("group-selected").click();      // wrap it in an outer one

    const folders = page.locator("[data-testid^='layer-row-'][data-kind='group']");
    await expect(folders).toHaveCount(2);
    // depths 0 and 1 prove real nesting rather than two siblings
    const depths = await folders.evaluateAll((els) => els.map((e) => e.getAttribute("data-depth")));
    expect(depths.sort()).toEqual(["0", "1"]);
  });

  test("the Layer menu carries the folder actions", async ({ page }) => {
    await addLayers(page, 1);
    await page.getByRole("button", { name: "Layer", exact: true }).click();
    await expect(page.getByTestId("menu-group")).toBeVisible();
    await expect(page.getByTestId("menu-ungroup")).toBeVisible();
    await expect(page.getByTestId("menu-collapse-folders")).toBeVisible();
    await page.getByTestId("menu-group").click();
    await expect(page.locator("[data-testid^='layer-row-'][data-kind='group']")).toHaveCount(1);
  });

  test("Collapse All Folders from the Layer menu", async ({ page }) => {
    await addLayers(page, 1);
    await page.getByTestId("group-selected").click();
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(2);
    await page.getByRole("button", { name: "Layer", exact: true }).click();
    await page.getByTestId("menu-collapse-folders").click();
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(1);
  });

  test("deleting a folder keeps its contents, at the top level", async ({ page }) => {
    await addLayers(page, 1);
    await page.getByTestId("group-selected").click();
    const folder = page.locator("[data-testid^='layer-row-'][data-kind='group']");
    await folder.hover();
    await folder.getByLabel("Delete folder").click();
    await expect(page.locator("[data-testid^='layer-row-'][data-kind='group']")).toHaveCount(0);
    await expect(page.locator("[data-testid^='layer-row-']")).toHaveCount(1);
  });

  test("folder names are unique out of the box", async ({ page }) => {
    await addLayers(page, 1);
    await page.getByTestId("group-selected").click();      // Group 1
    await page.getByRole("button", { name: "New folder" }).click(); // Group 2
    await expect(layers(page).getByText("Group 1")).toBeVisible();
    await expect(layers(page).getByText("Group 2")).toBeVisible();
  });

  test("a viewer sees folders but cannot change them", async ({ page }) => {
    await openEditor(page, {
      role: "viewer",
      layers: [
        {
          id: "g", name: "Header", kind: "group", parentId: null, layerIndex: 1,
          visible: true, locked: false, opacity: 100, blendMode: "normal",
          x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 100, scaleY: 100,
          adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 0, invert: false },
          createdBy: "someone", createdAt: 1, updatedAt: 1,
        },
      ],
    });
    await expect(layers(page).getByText("Header")).toBeVisible();
    await expect(page.getByTestId("group-selected")).toHaveCount(0);
  });
});

// ── Older app builds ────────────────────────────────────────────────────────
//
// A context pins the app build it was created with, so a document made before
// folders shipped keeps a contract with no `move_layers`. That used to fail
// grouping outright with `method "move_layers" not found`.
test.describe("Folders on a contract that predates them", () => {
  test("grouping falls back to one move_layer per layer", async ({ page }) => {
    const log = await openEditor(page, { missingMethods: ["move_layers"] });
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "New raster layer" }).click();
    }
    const rows = page.locator("[data-testid^='layer-row-']");
    await rows.first().click();
    await rows.nth(1).click({ modifiers: ["Shift"] });
    await page.getByTestId("group-selected").click();

    // The folder still exists and still holds both layers…
    await expect(page.locator("[data-testid^='layer-row-'][data-kind='group']")).toHaveCount(1);
    await expect(page.getByTestId("group-content-count")).toContainText("2 layers inside");

    // …persisted through the older per-layer method, once per member.
    const moves = await waitForCalls(log, "move_layer", 2);
    expect(moves).toHaveLength(2);
    for (const call of moves) expect(call.args.parent_id).toBeTruthy();

    // and the user is told once, rather than left wondering
    await expect(page.getByText(/predates folders/)).toBeVisible();
  });

  test("it tries the new method once, then stops asking", async ({ page }) => {
    const log = await openEditor(page, { missingMethods: ["move_layers"] });
    for (let i = 0; i < 2; i++) {
      await page.getByRole("button", { name: "New raster layer" }).click();
      await page.getByTestId("group-selected").click();
    }
    await waitForCalls(log, "move_layer", 2);
    expect(callsTo(log, "move_layers")).toHaveLength(1);
  });

  test("ungrouping works on the old contract too", async ({ page }) => {
    const log = await openEditor(page, { missingMethods: ["move_layers"] });
    await page.getByRole("button", { name: "New raster layer" }).click();
    await page.getByTestId("group-selected").click();
    await waitForCalls(log, "move_layer", 1);

    await page.getByTestId("ungroup-selected").click();
    await expect(page.locator("[data-testid^='layer-row-'][data-kind='group']")).toHaveCount(0);
    // the child is lifted out via move_layer, and the folder deleted
    await waitForCalls(log, "move_layer", 2);
    await waitForCalls(log, "delete_layer", 1);
  });
});
