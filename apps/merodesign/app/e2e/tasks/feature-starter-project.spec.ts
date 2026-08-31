import { test, expect } from "@playwright/test";
import { openBoard, isTauriBuild } from "../fixtures/board";
import { element, pixelAt, near, paintedBox } from "../fixtures/canvas";

/**
 * "Open starter project" — loads the bundled five-screen design and persists it
 * into contract state, so it reaches every member rather than living in local
 * canvas state. Runs in both the browser and the Tauri project.
 */
test.describe("starter project", () => {
  test("the menu item is offered to an admin", async ({ page }) => {
    await openBoard(page, { role: "admin" });
    await page.locator('[data-testid="options-btn"]').click();
    await expect(page.locator('[data-testid="open-starter"]')).toBeVisible();
  });

  test("a viewer never sees it", async ({ page }) => {
    await openBoard(page, { role: "viewer" });
    await page.locator('[data-testid="options-btn"]').click();
    await expect(page.locator('[data-testid="open-starter"]')).toHaveCount(0);
  });

  test("an empty board loads without a confirm step", async ({ page }) => {
    const board = await openBoard(page, { role: "admin" });
    await page.locator('[data-testid="options-btn"]').click();
    await page.locator('[data-testid="open-starter"]').click();
    await expect.poll(() => board.calledWith("add_element").length, { timeout: 90000 }).toBeGreaterThan(400);
  });

  test("an occupied board asks once before replacing it", async ({ page }) => {
    const board = await openBoard(page, {
      role: "admin",
      elements: [element({ id: "mine", x: 50, y: 50, fill: "#FF00FF" })],
    });
    await page.locator('[data-testid="options-btn"]').click();
    await page.locator('[data-testid="open-starter"]').click();
    // first click only arms it
    await expect(page.locator('[data-testid="open-starter-confirm"]')).toBeVisible();
    expect(board.calledWith("clear_elements")).toHaveLength(0);
    await page.locator('[data-testid="open-starter-confirm"]').click();
    await expect.poll(() => board.calledWith("clear_elements").length, { timeout: 90000 }).toBe(1);
  });

  /** The whole point: app data has to end up as WASM data. */
  test("every element is persisted through add_element, after a clear", async ({ page }) => {
    const board = await openBoard(page, { role: "admin" });
    await page.locator('[data-testid="options-btn"]').click();
    await page.locator('[data-testid="open-starter"]').click();
    // Comments are sent after every element, so wait on the *last* thing written.
    await expect.poll(() => board.calledWith("add_comment").length, { timeout: 90000 }).toBeGreaterThanOrEqual(2);
    expect(board.calledWith("add_element").length).toBeGreaterThan(400);

    const order = board.calls.map((c) => c.method);
    expect(order.indexOf("clear_elements")).toBeLessThan(order.indexOf("add_element"));
    expect(board.calledWith("update_board")).toHaveLength(1);

    const kinds = new Set(
      board.calledWith("add_element").map((c) => (c.args.element as { data: { kind: string } }).data.kind),
    );
    expect([...kinds].sort()).toEqual(["circle", "rect", "text"]);
  });

  test("the five screen grounds land at their declared coordinates", async ({ page }) => {
    const board = await openBoard(page, { role: "admin" });
    await page.locator('[data-testid="options-btn"]').click();
    await page.locator('[data-testid="open-starter"]').click();
    await expect.poll(() => board.calledWith("add_element").length, { timeout: 90000 }).toBeGreaterThan(400);

    const screens = board
      .calledWith("add_element")
      .map((c) => c.args.element as { label?: string | null; x: number; width: number })
      .filter((e) => (e.label ?? "").startsWith("screen/"));
    expect(screens).toHaveLength(5);
    // laid out left to right on a 1440 + 140 pitch, like frames in a design file
    expect(screens.map((s) => s.x)).toEqual([0, 1580, 3160, 4740, 6320]);
  });

  test("the first screen is actually painted after loading", async ({ page }) => {
    const board = await openBoard(page, { role: "admin" });
    await page.locator('[data-testid="options-btn"]').click();
    await page.locator('[data-testid="open-starter"]').click();
    await expect.poll(() => board.calledWith("add_element").length, { timeout: 90000 }).toBeGreaterThan(400);
    // The sign-in screen's indigo panel covers (0,0)-(640,900).
    await expect
      .poll(async () => near(await pixelAt(page, 300, 500), "#4F46E5", 12), { timeout: 30000 })
      .toBe(true);
  });

  test("three font families and a wide type scale survive the round trip", async ({ page }) => {
    const board = await openBoard(page, { role: "admin" });
    await page.locator('[data-testid="options-btn"]').click();
    await page.locator('[data-testid="open-starter"]').click();
    await expect.poll(() => board.calledWith("add_element").length, { timeout: 90000 }).toBeGreaterThan(400);

    const texts = board
      .calledWith("add_element")
      .map((c) => c.args.element as { data: { kind: string; fontFamily?: string; fontSize?: number } })
      .filter((e) => e.data.kind === "text");
    expect(new Set(texts.map((t) => t.data.fontFamily)).size).toBe(3);
    expect(new Set(texts.map((t) => t.data.fontSize)).size).toBeGreaterThanOrEqual(10);
  });

  test("the button matrix reaches the board with all twelve variants", async ({ page }) => {
    const board = await openBoard(page, { role: "admin" });
    await page.locator('[data-testid="options-btn"]').click();
    await page.locator('[data-testid="open-starter"]').click();
    await expect.poll(() => board.calledWith("add_element").length, { timeout: 90000 }).toBeGreaterThan(400);

    const labels = board
      .calledWith("add_element")
      .map((c) => (c.args.element as { label?: string | null }).label ?? "")
      .filter((l) => l.startsWith("btn/"));
    for (const variant of ["primary", "secondary", "ghost", "danger"]) {
      for (const size of ["sm", "md", "lg"]) {
        expect(labels).toContain(`btn/${variant}-${size}`);
      }
    }
  });

  test("loads the same way under the Tauri bridge", async ({ page }) => {
    const board = await openBoard(page, { role: "admin" });
    // documents which environment this run exercised
    const tauri = await isTauriBuild(page);
    await page.locator('[data-testid="options-btn"]').click();
    await page.locator('[data-testid="open-starter"]').click();
    await expect.poll(() => board.calledWith("add_element").length, { timeout: 90000 }).toBeGreaterThan(400);
    expect(typeof tauri).toBe("boolean");
    const box = await paintedBox(page, "#4F46E5", 6);
    expect(box).not.toBeNull();
  });
});
