import { test, expect, type Page } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import { element } from "../fixtures/canvas";

/**
 * Screens and presentation mode — Figma's "Present".
 *
 * A screen is a rect labelled `screen/<name>`; its area is the slide. These
 * specs drive the real UI against the mocked node and check three things the
 * unit tests cannot: that presenting is wired to the live board, that the
 * keyboard belongs to the presentation while it is up (the board underneath is
 * still mounted — a stray Backspace would delete the selection), and that
 * "Create screen" writes the screen into contract state.
 */

const screen = (id: string, name: string, x: number, y: number, extra = {}) =>
  element({ id, label: `screen/${name}`, x, y, width: 400, height: 300, fill: "#FFFFFF", layerIndex: 0, ...extra });

// Three screens, deliberately listed out of reading order.
const BOARD = [
  screen("s3", "Third", 0, 600),
  screen("s2", "Second", 600, 0),
  screen("s1", "First", 0, 0),
  element({ id: "inside", x: 40, y: 40, width: 80, height: 60, fill: "#FF00FF", layerIndex: 1 }),
  element({ id: "away", x: 2000, y: 2000, width: 80, height: 60, fill: "#00FF00", layerIndex: 2 }),
];

async function present(page: Page) {
  await page.getByTestId("toolbar-present").click();
  await expect(page.getByTestId("presentation")).toBeVisible();
}

async function openScreensTab(page: Page) {
  await page.getByText("Screens", { exact: true }).click();
}

test.describe("presenting", () => {
  test("plays screens in reading order, by keyboard and by button", async ({ page }) => {
    await openBoard(page, { elements: BOARD });
    await present(page);

    const title = page.getByTestId("presentation-title");
    const counter = page.getByTestId("presentation-counter");
    await expect(title).toHaveText("First");
    await expect(counter).toHaveText("1 / 3");

    await page.keyboard.press("ArrowRight");
    await expect(title).toHaveText("Second");
    await page.getByTestId("presentation-next").click();
    await expect(title).toHaveText("Third");
    await expect(page.getByTestId("presentation-next")).toBeDisabled();

    await page.keyboard.press("Home");
    await expect(title).toHaveText("First");
    await page.keyboard.press("End");
    await expect(counter).toHaveText("3 / 3");
    await page.keyboard.press("ArrowLeft");
    await expect(title).toHaveText("Second");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("presentation")).toHaveCount(0);
  });

  test("the slide is the screen's area: what is inside, clipped at its edge", async ({ page }) => {
    await openBoard(page, { elements: BOARD });
    await present(page);
    const slide = page.getByTestId("presentation-slide");
    await expect(slide).toBeVisible();
    await expect(slide).toHaveAttribute("data-screen-id", "s1");

    const svg = await slide.evaluate(async (img: HTMLImageElement) => (await fetch(img.src)).text());
    expect(svg).toContain('viewBox="0 0 400 300"');
    expect(svg).toContain("#FF00FF"); // on the screen
    expect(svg).not.toContain("#00FF00"); // elsewhere on the board

    // Drawn at the screen's aspect ratio, whatever the window.
    const box = (await slide.boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(400 / 300, 1);
  });

  test("starts from the screen the selection is on", async ({ page }) => {
    await openBoard(page, { elements: BOARD });
    await page.getByText("Layers", { exact: true }).click();
    await page.getByTestId("layer-item-s2").click();
    await present(page);
    await expect(page.getByTestId("presentation-title")).toHaveText("Second");
  });

  test("a tall screen scrolls, and Space reads it before moving on", async ({ page }) => {
    await openBoard(page, {
      elements: [
        screen("long", "Landing page", 0, 0, { width: 1440, height: 6000 }),
        screen("next", "After", 2000, 0),
      ],
    });
    await present(page);
    const stage = page.getByTestId("presentation-stage");
    await expect(stage).toHaveAttribute("data-scrolls", "true");

    await page.keyboard.press(" ");
    await expect.poll(() => stage.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(page.getByTestId("presentation-title")).toHaveText("Landing page");

    // Past the bottom, Space moves on — and the next screen opens at its top.
    await stage.evaluate((el) => el.scrollTo({ top: el.scrollHeight }));
    await page.keyboard.press(" ");
    await expect(page.getByTestId("presentation-title")).toHaveText("After");
    await expect(stage).toHaveAttribute("data-scrolls", "false");
  });

  test("keys pressed while presenting never reach the board underneath", async ({ page }) => {
    const board = await openBoard(page, { elements: BOARD });
    await page.getByText("Layers", { exact: true }).click();
    await page.getByTestId("layer-item-inside").click();
    await present(page);

    for (const key of ["Backspace", "Delete", "ArrowDown", "Meta+z", "Escape"]) await page.keyboard.press(key);
    await expect(page.getByTestId("presentation")).toHaveCount(0);
    // Escape left the presentation; it did not also go on to the canvas.
    await page.waitForTimeout(300);
    expect(board.calledWith("delete_element")).toHaveLength(0);
    expect(board.calledWith("update_element")).toHaveLength(0);
  });

  test("a board with no screens explains how to make one", async ({ page }) => {
    await openBoard(page, { elements: [element({ id: "a" })] });
    await present(page);
    await expect(page.getByTestId("presentation-empty")).toContainText("no screens");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("presentation")).toHaveCount(0);
  });

  test("the filmstrip jumps to any screen", async ({ page }) => {
    await openBoard(page, { elements: BOARD });
    await present(page);
    await page.getByTestId("presentation-strip-toggle").click();
    await page.getByTestId("presentation-thumb-s3").click();
    await expect(page.getByTestId("presentation-title")).toHaveText("Third");
  });
});

test.describe("the Screens tab", () => {
  test("lists screens in the order they play, and presents from a row", async ({ page }) => {
    await openBoard(page, { elements: BOARD });
    await openScreensTab(page);
    const names = page.locator('[data-testid^="screen-name-"]');
    await expect(names).toHaveText(["First", "Second", "Third"]);

    await page.getByTestId("screen-menu-s3").click();
    await page.getByTestId("screen-present-s3").click();
    await expect(page.getByTestId("presentation-title")).toHaveText("Third");
  });

  test("creating a screen from a selection writes a backdrop behind it to the contract", async ({ page }) => {
    const board = await openBoard(page, {
      elements: [
        element({ id: "a", x: 100, y: 100, width: 50, height: 50, layerIndex: 0 }),
        element({ id: "b", x: 300, y: 200, width: 50, height: 50, layerIndex: 1 }),
      ],
    });
    await page.getByText("Layers", { exact: true }).click();
    await page.getByTestId("layer-item-a").click();
    await page.getByTestId("layer-item-b").click({ modifiers: ["Shift"] });
    await openScreensTab(page);
    await page.getByTestId("screens-create").click();

    await expect(page.locator('[data-testid^="screen-name-"]')).toHaveText(["Screen 1"]);
    const [add] = board.calledWith("add_element");
    const created = (add.args as { element: Record<string, unknown> }).element;
    // The selection's box, plus 40 of breathing room on every side.
    expect(created).toMatchObject({ label: "screen/Screen 1", x: 60, y: 60, width: 330, height: 230 });
    // "a" was already at the very bottom, so the backdrop has to be sent below it.
    await expect.poll(() => board.calledWith("send_to_back").map((c) => c.args.id)).toEqual([created.id]);
  });

  test("a single selected rect becomes the screen itself", async ({ page }) => {
    const board = await openBoard(page, {
      elements: [element({ id: "frame", label: "Hero", x: 0, y: 0, width: 800, height: 500 })],
    });
    await page.getByText("Layers", { exact: true }).click();
    await page.getByTestId("layer-item-frame").click();
    await openScreensTab(page);
    await page.getByTestId("screens-create").click();

    await expect(page.locator('[data-testid^="screen-name-"]')).toHaveText(["Hero"]);
    expect(board.calledWith("add_element")).toHaveLength(0);
    await expect
      .poll(() => board.calledWith("update_element_label").map((c) => c.args))
      .toEqual([expect.objectContaining({ id: "frame", label: "screen/Hero" })]);
  });

  test("renaming and removing a screen are label writes", async ({ page }) => {
    const board = await openBoard(page, { elements: BOARD });
    await openScreensTab(page);
    await page.getByTestId("screen-menu-s1").click();
    await page.getByTestId("screen-rename-s1").click();
    const input = page.getByTestId("screen-name-input-s1");
    await input.fill("Welcome");
    await input.press("Enter");
    await expect(page.getByTestId("screen-name-s1")).toHaveText("Welcome");

    await page.getByTestId("screen-menu-s2").click();
    await page.getByTestId("screen-unmark-s2").click();
    await expect(page.locator('[data-testid^="screen-name-"]')).toHaveText(["Welcome", "Third"]);

    await expect
      .poll(() => board.calledWith("update_element_label").map((c) => [c.args.id, c.args.label]))
      .toEqual([["s1", "screen/Welcome"], ["s2", "Second"]]);
    // Removing a screen keeps the rect on the board.
    expect(board.calledWith("delete_element")).toHaveLength(0);
  });

  test("a viewer can present but not make screens", async ({ page }) => {
    await openBoard(page, { elements: BOARD, role: "viewer" });
    await openScreensTab(page);
    await expect(page.getByTestId("screens-create")).toBeDisabled();
    await page.getByTestId("screens-present").click();
    await expect(page.getByTestId("presentation-title")).toHaveText("First");
  });
});
