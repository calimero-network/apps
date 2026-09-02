import { test, expect, type Page } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element } from "../fixtures/canvas";
import { downloadText, downloads, recordDownloads } from "../fixtures/downloads";

/**
 * Groups and frames — the Figma-shaped gap in IMPORTANT.md item 15, and the
 * reason the starter board reads as 470 anonymous layers.
 *
 * A group is a `/`-separated path in the element's `label`, persisted with
 * `update_element_label`. So these specs assert two things at once: the tree the
 * panel builds, and that membership reaches contract state rather than living in
 * a local side table nobody else can see.
 */
const BOARD = [
  element({ id: "a", label: "screen/header", x: 40, y: 40, fill: "#FF00FF", layerIndex: 0 }),
  element({ id: "b", label: "screen/body", x: 120, y: 40, fill: "#00FFFF", layerIndex: 1 }),
  element({ id: "c", label: "loose", x: 220, y: 40, fill: "#FFFF00", layerIndex: 2 }),
  element({ id: "d", x: 300, y: 40, fill: "#00FF00", layerIndex: 3 }),
];

async function openLayers(page: Page) {
  await page.getByText("Layers", { exact: true }).click();
}

test.describe("layers tree", () => {
  test("labelled elements nest under their group", async ({ page }) => {
    await openBoard(page, { elements: BOARD });
    await openLayers(page);
    await expect(page.locator('[data-testid="layer-group-screen"]')).toBeVisible();
    await expect(page.locator('[data-testid="layer-item-a"]')).toBeVisible();
    // The group carries its member count.
    await expect(page.locator('[data-testid="layer-group-screen"]')).toContainText("2");
  });

  test("an unlabelled element is named after its kind, and text after its content", async ({ page }) => {
    await openBoard(page, {
      elements: [
        element({ id: "d" }),
        element({ id: "t", data: { kind: "text", content: "Sign in", fontSize: 20, fontFamily: "sans-serif", bold: false, italic: false } }),
      ],
    });
    await openLayers(page);
    await expect(page.locator('[data-testid="layer-item-d"]')).toContainText("rect");
    await expect(page.locator('[data-testid="layer-item-t"]')).toContainText("Sign in");
  });

  test("collapsing a group hides its contents", async ({ page }) => {
    await openBoard(page, { elements: BOARD });
    await openLayers(page);
    await page.locator('[data-testid="layer-toggle-screen"]').click();
    await expect(page.locator('[data-testid="layer-item-a"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="layer-group-screen"]')).toBeVisible();
  });

  test("selecting a group selects every member", async ({ page }) => {
    await openBoard(page, { elements: BOARD });
    await openLayers(page);
    await page.locator('[data-testid="layer-group-screen"]').click();
    await page.getByText("Props", { exact: true }).click();
    await expect(page.getByText("2 selected")).toBeVisible();
  });

  test("the filter narrows the tree", async ({ page }) => {
    await openBoard(page, { elements: BOARD });
    await openLayers(page);
    await page.locator('[data-testid="layer-filter"]').fill("loose");
    await expect(page.locator('[data-testid="layer-item-c"]')).toBeVisible();
    await expect(page.locator('[data-testid="layer-item-a"]')).toHaveCount(0);
  });
});

test.describe("grouping", () => {
  test("Group writes a path label for every selected layer", async ({ page }) => {
    const board = await openBoard(page, { elements: BOARD });
    await openLayers(page);
    await page.locator('[data-testid="layer-item-c"]').click();
    await page.locator('[data-testid="layer-item-d"]').click({ modifiers: ["Shift"] });
    await page.locator('[data-testid="group-selection"]').click();

    await expect.poll(() => board.calledWith("update_element_label").length, { timeout: 15000 }).toBe(2);
    const labels = board.calledWith("update_element_label").map((c) => c.args.label as string).sort();
    expect(labels).toEqual(["Group 1/loose", "Group 1/rect"]);
    await expect(page.locator('[data-testid="layer-group-Group 1"]')).toBeVisible();
  });

  test("⌘G groups from the canvas too, through the same path", async ({ page }) => {
    const board = await openBoard(page, { elements: BOARD });
    await openLayers(page);
    await page.locator('[data-testid="layer-item-c"]').click();
    await page.locator('[data-testid="layer-item-d"]').click({ modifiers: ["Shift"] });
    await page.keyboard.press(process.platform === "darwin" ? "Meta+g" : "Control+g");
    await expect.poll(() => board.calledWith("update_element_label").length, { timeout: 15000 }).toBe(2);
  });

  test("Ungroup lifts members back out of the group", async ({ page }) => {
    const board = await openBoard(page, { elements: BOARD });
    await openLayers(page);
    await page.locator('[data-testid="layer-group-screen"]').click();
    await page.locator('[data-testid="ungroup-selection"]').click();
    await expect.poll(() => board.calledWith("update_element_label").length, { timeout: 15000 }).toBe(2);
    const labels = board.calledWith("update_element_label").map((c) => c.args.label as string).sort();
    expect(labels).toEqual(["body", "header"]);
  });

  test("Frame adds a backdrop and groups everything under it", async ({ page }) => {
    const board = await openBoard(page, { elements: BOARD });
    await openLayers(page);
    await page.locator('[data-testid="layer-item-c"]').click();
    await page.locator('[data-testid="frame-selection"]').click();

    await expect.poll(() => board.calledWith("add_element").length, { timeout: 15000 }).toBe(1);
    const backdrop = board.calledWith("add_element")[0].args.element as { label: string; width: number };
    expect(backdrop.label).toBe("Frame 1/Background");
    // 40px shape plus 16px padding on both sides.
    expect(backdrop.width).toBe(72);
    await expect(page.locator('[data-testid="layer-group-Frame 1"]')).toBeVisible();
  });

  test("a group exports as one SVG holding only its members", async ({ page }) => {
    await recordDownloads(page);
    await openBoard(page, { elements: BOARD });
    await openLayers(page);
    await page.locator('[data-testid="group-menu-screen"]').click();
    await page.locator('[data-testid="export-group-svg-screen"]').click();

    await expect.poll(async () => (await downloads(page)).length, { timeout: 20000 }).toBe(1);
    const [file] = await downloads(page);
    expect(file.download).toBe("screen.svg");
    const svg = await downloadText(page, file.href);
    expect(svg).toContain("<svg");
    // The two members are in; the layer outside the group is not.
    expect(svg).toContain("#FF00FF");
    expect(svg).toContain("#00FFFF");
    expect(svg).not.toContain("#FFFF00");
  });

  test("merging a group replaces it with a single svg element", async ({ page }) => {
    const board = await openBoard(page, { elements: BOARD, serveBlob: true });
    await openLayers(page);
    await page.locator('[data-testid="group-menu-screen"]').click();
    await page.locator('[data-testid="flatten-screen"]').click();  // arms
    await page.locator('[data-testid="group-menu-screen"]').click();
    await page.locator('[data-testid="flatten-screen"]').click();  // confirms

    await expect.poll(() => board.calledWith("add_element").length, { timeout: 20000 }).toBe(1);
    const created = board.calledWith("add_element")[0].args.element as { data: { kind: string } };
    expect(created.data.kind).toBe("svg");
    await expect.poll(() => board.calledWith("delete_element").map((c) => c.args.id).sort(), { timeout: 20000 })
      .toEqual(["a", "b"]);
  });
});
