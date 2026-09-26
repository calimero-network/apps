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
    expect(board.writes("delete_element")).toHaveLength(0);
    expect(board.writes("update_element")).toHaveLength(0);
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
    const [add] = board.writes("add_element");
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
    expect(board.writes("add_element")).toHaveLength(0);
    await expect
      .poll(() => board.writes("update_element_label").map((c) => c.args))
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
      .poll(() => board.writes("update_element_label").map((c) => [c.args.id, c.args.label]))
      .toEqual([["s1", "screen/Welcome"], ["s2", "Second"]]);
    // Removing a screen keeps the rect on the board.
    expect(board.writes("delete_element")).toHaveLength(0);
  });

  test("a viewer can present but not make screens", async ({ page }) => {
    await openBoard(page, { elements: BOARD, role: "viewer" });
    await openScreensTab(page);
    await expect(page.getByTestId("screens-create")).toBeDisabled();
    await page.getByTestId("screens-present").click();
    await expect(page.getByTestId("presentation-title")).toHaveText("First");
  });
});

test.describe("reordering screens", () => {
  // Four in a row, so reading order is One-Two-Three-Four.
  const ROW = [
    screen("s1", "One", 0, 0),
    screen("s2", "Two", 600, 0),
    screen("s3", "Three", 1200, 0),
    screen("s4", "Four", 1800, 0),
  ];
  const names = (page: Page) => page.locator('[data-testid^="screen-name-"]');

  async function presentedOrder(page: Page): Promise<string[]> {
    await page.getByTestId("screens-present").click();
    await page.keyboard.press("Home");
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      seen.push((await page.getByTestId("presentation-title").textContent()) ?? "");
      await page.keyboard.press("ArrowRight");
    }
    await page.keyboard.press("Escape");
    return seen;
  }

  test("dragging 4 above 2 turns 1-2-3-4 into 1-4-2-3 — in the tab, the presentation, and the contract", async ({ page }) => {
    const board = await openBoard(page, { elements: ROW });
    await openScreensTab(page);
    await expect(names(page)).toHaveText(["One", "Two", "Three", "Four"]);

    // Drop on the top half of "Two": lands before it.
    await page.getByTestId("screen-row-s4").dragTo(page.getByTestId("screen-row-s2"), {
      targetPosition: { x: 40, y: 4 },
    });
    await expect(names(page)).toHaveText(["One", "Four", "Two", "Three"]);
    expect(await presentedOrder(page)).toEqual(["One", "Four", "Two", "Three"]);

    await expect
      .poll(() => Object.fromEntries(board.writes("update_element_label").map((c) => [c.args.id, c.args.label])))
      .toEqual({ s1: "screen/One @1", s4: "screen/Four @2", s2: "screen/Two @3", s3: "screen/Three @4" });

    // It is contract state, not a local sort: a reload reads the same order back.
    await page.reload();
    await page.waitForSelector('[data-testid="fabric-canvas"]');
    await openScreensTab(page);
    await expect(names(page)).toHaveText(["One", "Four", "Two", "Three"]);
  });

  test("dropping on the lower half of a row lands after it", async ({ page }) => {
    await openBoard(page, { elements: ROW });
    await openScreensTab(page);
    const target = page.getByTestId("screen-row-s3");
    const box = (await target.boundingBox())!;
    await page.getByTestId("screen-row-s1").dragTo(target, { targetPosition: { x: 40, y: box.height - 4 } });
    await expect(names(page)).toHaveText(["Two", "Three", "One", "Four"]);
  });

  test("the drop indicator shows where the screen will land", async ({ page }) => {
    await openBoard(page, { elements: ROW });
    await openScreensTab(page);
    const source = page.getByTestId("screen-row-s4");
    const target = page.getByTestId("screen-row-s2");
    const from = (await source.boundingBox())!;
    const to = (await target.boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 40, to.y + 6, { steps: 8 });
    await expect(target).toHaveAttribute("data-drop", "before");
    await page.mouse.move(to.x + 40, to.y + to.height - 6, { steps: 4 });
    await expect(target).toHaveAttribute("data-drop", "after");
    await page.mouse.up();
    await expect(names(page)).toHaveText(["One", "Two", "Four", "Three"]);
  });

  /** Press a row, travel to `y` (absolute) in steps, release. Pointer events only. */
  async function pointerDrag(page: Page, sourceId: string, y: number) {
    const from = (await page.getByTestId(`screen-row-${sourceId}`).boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + 40, y, { steps: 10 });
    await page.mouse.up();
  }

  test("reordering never depends on HTML5 drag-and-drop (Tauri's native drop handler eats it)", async ({ page }) => {
    // What a Tauri window with its drag-drop handler on does to the page: the
    // HTML5 drag events never arrive. Killed in the capture phase, before React.
    await page.addInitScript(() => {
      for (const type of ["dragstart", "dragenter", "dragover", "dragleave", "drop", "dragend"]) {
        window.addEventListener(type, (e) => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
      }
    });
    const board = await openBoard(page, { elements: ROW });
    await openScreensTab(page);
    const two = (await page.getByTestId("screen-row-s2").boundingBox())!;
    await pointerDrag(page, "s4", two.y + 4);
    await expect(names(page)).toHaveText(["One", "Four", "Two", "Three"]);
    await expect
      .poll(() => Object.fromEntries(board.writes("update_element_label").map((c) => [c.args.id, c.args.label])))
      .toEqual({ s1: "screen/One @1", s4: "screen/Four @2", s2: "screen/Two @3", s3: "screen/Three @4" });
  });

  test("dragging past either end of the list lands first or last", async ({ page }) => {
    await openBoard(page, { elements: ROW });
    await openScreensTab(page);
    const first = (await page.getByTestId("screen-row-s1").boundingBox())!;
    await pointerDrag(page, "s3", first.y - 40);
    await expect(names(page)).toHaveText(["Three", "One", "Two", "Four"]);
    const last = (await page.getByTestId("screen-row-s4").boundingBox())!;
    await pointerDrag(page, "s3", last.y + last.height + 60);
    await expect(names(page)).toHaveText(["One", "Two", "Four", "Three"]);
  });

  test("a click is still a click: it selects, and moves nothing", async ({ page }) => {
    const board = await openBoard(page, { elements: ROW });
    await openScreensTab(page);
    await page.getByTestId("screen-row-s3").click();
    await expect(page.getByTestId("screen-row-s3")).toHaveAttribute("data-active", "true");
    await expect(names(page)).toHaveText(["One", "Two", "Three", "Four"]);
    expect(board.writes("update_element_label")).toHaveLength(0);
  });

  test("the row that was dragged is not also selected by the release", async ({ page }) => {
    await openBoard(page, { elements: ROW });
    await openScreensTab(page);
    const one = (await page.getByTestId("screen-row-s1").boundingBox())!;
    await pointerDrag(page, "s4", one.y + 4);
    await expect(names(page)).toHaveText(["Four", "One", "Two", "Three"]);
    await expect(page.getByTestId("screen-row-s4")).not.toHaveAttribute("data-active", "true");
  });

  test("Escape abandons a drag in flight", async ({ page }) => {
    const board = await openBoard(page, { elements: ROW });
    await openScreensTab(page);
    const from = (await page.getByTestId("screen-row-s4").boundingBox())!;
    const to = (await page.getByTestId("screen-row-s1").boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 40, to.y + 4, { steps: 8 });
    await expect(page.getByTestId("screen-row-s1")).toHaveAttribute("data-drop", "before");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("screen-row-s1")).not.toHaveAttribute("data-drop", /./);
    await page.mouse.up();
    await expect(names(page)).toHaveText(["One", "Two", "Three", "Four"]);
    expect(board.writes("update_element_label")).toHaveLength(0);
    // The board underneath did not read that Escape as "delete the selection".
    expect(board.writes("delete_element")).toHaveLength(0);
  });

  test("Move up / Move down in the row menu", async ({ page }) => {
    await openBoard(page, { elements: ROW });
    await openScreensTab(page);
    await page.getByTestId("screen-menu-s3").click();
    await page.getByTestId("screen-move-up-s3").click();
    await expect(names(page)).toHaveText(["One", "Three", "Two", "Four"]);

    await page.getByTestId("screen-menu-s1").click();
    await expect(page.getByTestId("screen-move-up-s1")).toBeDisabled();
    await page.getByTestId("screen-move-down-s1").click();
    await expect(names(page)).toHaveText(["Three", "One", "Two", "Four"]);
  });

  test("Alt+↑ / Alt+↓ on a focused row, for the keyboard", async ({ page }) => {
    await openBoard(page, { elements: ROW });
    await openScreensTab(page);
    await page.getByTestId("screen-row-s4").focus();
    await page.keyboard.press("Alt+ArrowUp");
    await page.keyboard.press("Alt+ArrowUp");
    await expect(names(page)).toHaveText(["One", "Four", "Two", "Three"]);
    await page.getByTestId("screen-row-s1").focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(names(page)).toHaveText(["Four", "One", "Two", "Three"]);
  });

  test("renaming a reordered screen keeps its place", async ({ page }) => {
    await openBoard(page, { elements: ROW });
    await openScreensTab(page);
    await page.getByTestId("screen-menu-s4").click();
    await page.getByTestId("screen-move-up-s4").click();
    await expect(names(page)).toHaveText(["One", "Two", "Four", "Three"]);

    await page.getByTestId("screen-menu-s4").click();
    await page.getByTestId("screen-rename-s4").click();
    await page.getByTestId("screen-name-input-s4").fill("Pricing");
    await page.getByTestId("screen-name-input-s4").press("Enter");
    await expect(names(page)).toHaveText(["One", "Two", "Pricing", "Three"]);
  });

  test("a new screen joins the end of an ordered deck", async ({ page }) => {
    const board = await openBoard(page, {
      elements: [
        screen("s1", "One @2", 0, 0),
        screen("s2", "Two @1", 600, 0),
        element({ id: "loose", x: -900, y: 0, width: 100, height: 100, layerIndex: 5 }),
      ],
    });
    await page.getByText("Layers", { exact: true }).click();
    await page.getByTestId("layer-item-loose").click();
    await openScreensTab(page);
    await page.getByTestId("screens-create").click();
    // Leftmost on the board, but last in the deck.
    await expect(names(page)).toHaveText(["Two", "One", "Screen 1"]);
    // A single selected rect becomes the screen itself, numbered after the rest.
    await expect
      .poll(() => board.writes("update_element_label").map((c) => [c.args.id, c.args.label]))
      .toEqual([["loose", "screen/Screen 1 @3"]]);
  });

  test("a viewer can see the order but not change it", async ({ page }) => {
    await openBoard(page, { elements: ROW, role: "viewer" });
    await openScreensTab(page);
    await expect(page.getByTestId("screen-row-s2")).toHaveAttribute("data-reorderable", "false");
    // And a real drag attempt changes nothing.
    const from = (await page.getByTestId("screen-row-s4").boundingBox())!;
    const to = (await page.getByTestId("screen-row-s1").boundingBox())!;
    await page.mouse.move(from.x + 40, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 40, to.y + 4, { steps: 8 });
    await page.mouse.up();
    await expect(names(page)).toHaveText(["One", "Two", "Three", "Four"]);
    await page.getByTestId("screen-menu-s2").click();
    await expect(page.getByTestId("screen-move-up-s2")).toBeDisabled();
  });
});

test.describe("the presentation starter", () => {
  test("loads from the Options menu and plays eight slides", async ({ page }) => {
    const board = await openBoard(page, { role: "admin" });
    await page.getByTestId("options-btn").click();
    await expect(page.getByTestId("open-starter")).toContainText("Web design");
    await page.getByTestId("open-starter-presentation").click();
    await expect.poll(() => board.writes("add_element").length, { timeout: 60000 }).toBe(206);

    await page.getByTestId("toolbar-present").click();
    await expect(page.getByTestId("presentation-title")).toHaveText("Calimero");
    await expect(page.getByTestId("presentation-counter")).toHaveText("1 / 8");
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("presentation-title")).toHaveText("One edit, end to end");
    await expect(page.getByTestId("presentation-stage")).toHaveAttribute("data-scrolls", "true");
  });

  test("an occupied board asks before the presentation replaces it", async ({ page }) => {
    const board = await openBoard(page, { role: "admin", elements: [element({ id: "mine" })] });
    await page.getByTestId("options-btn").click();
    await page.getByTestId("open-starter-presentation").click();
    await expect(page.getByTestId("open-starter-presentation-confirm")).toBeVisible();
    // Arming one starter does not arm the other.
    await expect(page.getByTestId("open-starter")).toBeVisible();
    expect(board.writes("delete_element")).toHaveLength(0);
    await page.getByTestId("open-starter-presentation-confirm").click();
    await expect
      .poll(() => board.writes("delete_element").map((c) => c.args.id), { timeout: 60000 })
      .toEqual(["mine"]);
  });
});
