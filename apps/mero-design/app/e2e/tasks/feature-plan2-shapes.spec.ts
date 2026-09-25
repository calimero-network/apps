import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openBoard, type Board } from "../fixtures/board";
import { element } from "../fixtures/canvas";

/**
 * plan2 (mero-design): outline shapes, new shape tools, text in rectangles,
 * sticky notes, stroke styles, ⌘/Ctrl multi-select, and connectors docked to
 * shape edges.
 *
 * The new per-element properties (dash style, box/sticky, shape, docks) are
 * not contract fields — they ride inside `label` after U+001F (see
 * src/utils/elementMeta.ts). So these specs assert on what reached the mocked
 * contract, unpacked here the same way the app unpacks it.
 */

const SEP = "\u001F";

/** The extras packed into a stored label, as a plain object. */
function extras(label: unknown): Record<string, string> {
  const raw = typeof label === "string" ? label : "";
  const at = raw.indexOf(SEP);
  return at === -1 ? {} : Object.fromEntries(new URLSearchParams(raw.slice(at + 1)));
}

type Added = {
  id: string; x: number; y: number; width: number; height: number;
  fill: string; stroke: string; strokeWidth: number; cornerRadius?: number;
  label?: string | null; data: { kind: string; points?: string; content?: string };
};

const lastAdded = (board: Board) => board.calledWith("add_element").at(-1)!.args.element as Added;

async function canvasBox(page: Page) {
  return (await page.getByTestId("fabric-canvas").boundingBox())!;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  const box = await canvasBox(page);
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

async function clickCanvas(page: Page, p: { x: number; y: number }, modifiers: ("Meta" | "Control" | "Shift")[] = []) {
  const box = await canvasBox(page);
  // `page.mouse.click` has no `modifiers` option (only locator.click does) —
  // passing one is silently ignored, so hold the keys down around the click.
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(box.x + p.x, box.y + p.y);
  for (const m of modifiers) await page.keyboard.up(m);
  await page.waitForTimeout(150);
}

async function store<T>(page: Page, pick: string): Promise<T> {
  return page.evaluate((expr) => {
    const s = (window as unknown as { __canvasStore: { getState(): Record<string, unknown> } }).__canvasStore.getState();
    return (new Function("s", `return ${expr}`))(s);
  }, pick) as Promise<T>;
}

/** Absolute endpoints of a line/arrow from its element-local points. */
function ends(el: Added) {
  const n = el.data.points!.split(/[\s,]+/).map(Number);
  return [{ x: el.x + n[0], y: el.y + n[1] }, { x: el.x + n[2], y: el.y + n[3] }];
}

test.describe("item 1+2: shape tools", () => {
  for (const tool of ["rect", "rounded", "circle", "triangle", "diamond", "star", "cloud"]) {
    test(`${tool}: drawn as an outline — no fill, 4px stroke`, async ({ page }) => {
      const board = await openBoard(page);
      await page.getByTestId(`tool-${tool}`).click();
      await drag(page, { x: 200, y: 200 }, { x: 340, y: 300 });
      await expect.poll(() => board.calledWith("add_element").length).toBe(1);
      const el = lastAdded(board);
      expect(el.fill).toBe("transparent");
      expect(el.strokeWidth).toBe(4);
      expect(el.stroke).not.toBe("transparent");
      if (tool === "rounded") expect(el.cornerRadius).toBe(16);
      if (["triangle", "diamond", "star", "cloud"].includes(tool)) {
        expect(el.data.kind).toBe("path");
        // Stored points too, so an older client still draws the outline.
        expect(el.data.points).toMatch(/^M /);
        expect(extras(el.label).h).toBe(tool);
      }
    });
  }

  test("a stroked rect keeps its size across two moves (stroke is not its size)", async ({ page }) => {
    const board = await openBoard(page, {
      elements: [element({ id: "r", x: 200, y: 200, width: 120, height: 80, fill: "#FF00FF", stroke: "#111111", strokeWidth: 4 })],
    });
    await drag(page, { x: 260, y: 240 }, { x: 310, y: 290 });
    await drag(page, { x: 310, y: 290 }, { x: 360, y: 340 });
    await expect.poll(() => board.calledWith("update_element").length).toBeGreaterThanOrEqual(2);
    for (const call of board.calledWith("update_element")) {
      expect(call.args.width).toBe(120);
      expect(call.args.height).toBe(80);
    }
  });

  test("single-letter shortcuts pick tools, but never while typing", async ({ page }) => {
    await openBoard(page);
    await page.keyboard.press("s");
    expect(await store<string>(page, "s.activeTool")).toBe("sticky");
    await page.keyboard.press("d");
    expect(await store<string>(page, "s.activeTool")).toBe("diamond");
    await page.keyboard.press("v");
    expect(await store<string>(page, "s.activeTool")).toBe("select");

    await page.getByRole("button", { name: /layers/i }).click();
    await page.getByTestId("layer-filter").click();
    await page.keyboard.type("r");
    expect(await store<string>(page, "s.activeTool")).toBe("select");
  });
});

test.describe("item 3: text inside a rectangle", () => {
  test("double-click a rect, type, and it becomes a box with centred text", async ({ page }) => {
    const board = await openBoard(page, {
      elements: [element({ id: "r", x: 200, y: 200, width: 200, height: 100, fill: "#FFFFFF", stroke: "#111111", strokeWidth: 4 })],
    });
    const box = await canvasBox(page);
    await page.mouse.dblclick(box.x + 300, box.y + 250);

    const editor = page.getByTestId("box-text-editor");
    await expect(editor).toBeVisible();
    // Same element, turned into a box — not a second object on top.
    await expect.poll(() => board.calledWith("add_element").length).toBe(1);
    const converted = lastAdded(board);
    expect(converted.id).toBe("r");
    expect(converted.data.kind).toBe("text");
    expect(extras(converted.label).b).toBe("box");

    await page.keyboard.type("Hello");
    await page.keyboard.press("Meta+Enter");
    await expect(editor).toHaveCount(0);
    await expect.poll(() => board.calledWith("update_text_style").map((c) => c.args.content)).toContain("Hello");

    // The words are painted inside the box.
    const inked = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="fabric-canvas"]') as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(260, 230, 80, 40).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 120 && d[i + 1] < 120 && d[i + 2] < 120) n++;
      return n;
    });
    expect(inked).toBeGreaterThan(20);

    // Alignment like a Figma frame: top.
    await page.getByTestId("align-v-top").click();
    await expect.poll(
      () => board.calledWith("update_text_style").map((c) => c.args.vertical_align),
      { timeout: 5000 },
    ).toContain("top");
    await page.getByTestId("align-h-right").click();
    await expect.poll(
      () => board.calledWith("update_text_style").map((c) => c.args.text_align),
      { timeout: 5000 },
    ).toContain("right");
  });

  test("the inspector's Add text opens the editor; leaving it empty keeps a plain rect", async ({ page }) => {
    const board = await openBoard(page, {
      elements: [element({ id: "r", x: 200, y: 200, width: 200, height: 100, fill: "transparent", stroke: "#111111", strokeWidth: 4 })],
    });
    await clickCanvas(page, { x: 300, y: 250 });
    await page.getByTestId("add-text-to-rect").click();
    await expect(page.getByTestId("box-text-editor")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("box-text-editor")).toHaveCount(0);
    await expect.poll(() => lastAdded(board).data.kind).toBe("rect");
    expect(extras(lastAdded(board).label).b).toBeUndefined();
  });
});

test.describe("item 5: sticky notes", () => {
  test("click to place a note, type into it, recolour it", async ({ page }) => {
    const board = await openBoard(page);
    await page.getByTestId("tool-sticky").click();
    await clickCanvas(page, { x: 400, y: 300 });

    await expect.poll(() => board.calledWith("add_element").length).toBe(1);
    const note = lastAdded(board);
    expect(extras(note.label).b).toBe("sticky");
    expect(note.fill).toBe("#FFE27A");
    expect([note.x, note.y, note.width, note.height]).toEqual([300, 200, 200, 200]);

    await expect(page.getByTestId("box-text-editor")).toBeVisible();
    await page.keyboard.type("Buy milk");
    await page.keyboard.press("Escape");
    await expect.poll(() => board.calledWith("update_text_style").map((c) => c.args.content)).toContain("Buy milk");

    await expect(page.getByTestId("element-kind")).toHaveText(/Sticky note/);
    await page.getByTestId("sticky-color-2").click();
    await expect.poll(
      () => board.calledWith("update_element").map((c) => c.args.fill),
      { timeout: 5000 },
    ).toContain("#FFB3C7");
  });

  test("a note grows to fit what is typed instead of hiding lines", async ({ page }) => {
    const board = await openBoard(page, {
      elements: [element({
        id: "n", x: 200, y: 150, width: 200, height: 200, fill: "#FFE27A", stroke: "transparent", strokeWidth: 0,
        label: `${SEP}b=sticky`,
        data: { kind: "text", content: "", fontSize: 18, fontFamily: "sans-serif", bold: false, italic: false, text_align: "left", vertical_align: "top" },
      })],
    });
    const box = await canvasBox(page);
    await page.mouse.dblclick(box.x + 300, box.y + 250);
    await expect(page.getByTestId("box-text-editor")).toBeVisible();
    for (let i = 0; i < 12; i++) {
      await page.keyboard.type(`line ${i}`);
      await page.keyboard.press("Enter");
    }
    await page.keyboard.press("Escape");
    await expect.poll(() => board.calledWith("update_element").map((c) => c.args.height as number)).toEqual(
      expect.arrayContaining([expect.any(Number)]),
    );
    const heights = board.calledWith("update_element").map((c) => c.args.height as number).filter(Boolean);
    expect(Math.max(...heights)).toBeGreaterThan(200);
  });
});

test.describe("item 6: stroke styles", () => {
  test("picking Dashed saves the style and the canvas paints a dash pattern", async ({ page }) => {
    const board = await openBoard(page, {
      elements: [element({ id: "r", x: 200, y: 200, width: 160, height: 100, fill: "transparent", stroke: "#111111", strokeWidth: 4 })],
    });
    await clickCanvas(page, { x: 280, y: 250 });
    await page.getByTestId("stroke-style-dashed").click();

    await expect.poll(() => board.calledWith("update_element_label").length).toBeGreaterThan(0);
    expect(extras(board.calledWith("update_element_label").at(-1)!.args.label).s).toBe("dashed");

    const dash = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="fabric-canvas"]') as HTMLCanvasElement & {
        __fabricCanvas: { getObjects(): { data?: { id: string }; strokeDashArray?: number[] | null }[] };
      };
      return c.__fabricCanvas.getObjects().find((o) => o.data?.id === "r")?.strokeDashArray ?? null;
    });
    expect(dash).toEqual([12, 8]);
  });

  test("a fill swatch then a width preset inside the debounce both reach the contract", async ({ page }) => {
    const board = await openBoard(page, {
      elements: [element({ id: "r", x: 200, y: 200, width: 160, height: 100, fill: "#FF00FF", stroke: "#111111", strokeWidth: 4 })],
    });
    await clickCanvas(page, { x: 280, y: 250 });
    await page.getByTestId("fill-swatch-1").click();
    await page.getByTestId("stroke-width-8").click();
    await expect.poll(() => board.calledWith("update_element").length, { timeout: 5000 }).toBeGreaterThan(0);
    const sent = board.calledWith("update_element").at(-1)!.args;
    expect(sent.fill).toBe("#e03131");
    expect(sent.stroke_width).toBe(8);
  });
});

test.describe("item 8: ⌘/Ctrl-click multi-select", () => {
  const two = () => [
    element({ id: "a", x: 100, y: 100, width: 80, height: 80, fill: "#FF00FF" }),
    element({ id: "b", x: 400, y: 300, width: 80, height: 80, fill: "#00FFFF", layerIndex: 1 }),
  ];

  for (const mod of ["Meta", "Control"] as const) {
    test(`${mod}-click adds to and removes from the selection`, async ({ page }) => {
      await openBoard(page, { elements: two() });
      await clickCanvas(page, { x: 140, y: 140 });
      await clickCanvas(page, { x: 440, y: 340 }, [mod]);
      expect((await store<string[]>(page, "s.selectedElementIds")).sort()).toEqual(["a", "b"]);
      const active = await page.evaluate(() => {
        const c = document.querySelector('[data-testid="fabric-canvas"]') as HTMLCanvasElement & {
          __fabricCanvas: { getActiveObjects(): unknown[] };
        };
        return c.__fabricCanvas.getActiveObjects().length;
      });
      expect(active).toBe(2);

      await clickCanvas(page, { x: 140, y: 140 }, [mod]);
      expect(await store<string[]>(page, "s.selectedElementIds")).toEqual(["b"]);
    });
  }
});

test.describe("connectors dock to the middle of a shape's edges", () => {
  const boxes = () => [
    element({ id: "A", x: 100, y: 100, width: 120, height: 80, fill: "transparent", stroke: "#111111", strokeWidth: 4 }),
    element({ id: "B", x: 400, y: 300, width: 120, height: 80, fill: "transparent", stroke: "#111111", strokeWidth: 4, layerIndex: 1 }),
  ];

  test("an arrow drawn near two edge midpoints snaps to them and remembers both", async ({ page }) => {
    const board = await openBoard(page, { elements: boxes() });
    await page.getByTestId("tool-arrow").click();
    // Starting ON shape A must draw, not grab A.
    await drag(page, { x: 216, y: 143 }, { x: 405, y: 336 });
    await expect.poll(() => board.calledWith("add_element").length).toBe(1);
    const arrow = lastAdded(board);
    expect(arrow.data.kind).toBe("arrow");
    expect(ends(arrow)).toEqual([{ x: 220, y: 140 }, { x: 400, y: 340 }]);
    expect(extras(arrow.label)).toMatchObject({ f: "A:right", t: "B:left" });
    expect(board.calledWith("update_element")).toHaveLength(0);
  });

  test("hovering a shape with the line tool shows its four anchors", async ({ page }) => {
    await openBoard(page, { elements: boxes() });
    await page.getByTestId("tool-line").click();
    const box = await canvasBox(page);
    await page.mouse.move(box.x + 160, box.y + 140);
    await page.mouse.move(box.x + 165, box.y + 142);
    const markers = await page.evaluate(() => {
      const c = document.querySelector('[data-testid="fabric-canvas"]') as HTMLCanvasElement & {
        __fabricCanvas: { getObjects(): { anchorMarker?: string }[] };
      };
      return c.__fabricCanvas.getObjects().filter((o) => o.anchorMarker).map((o) => o.anchorMarker).sort();
    });
    expect(markers).toEqual(["A:bottom", "A:left", "A:right", "A:top"]);
  });

  test("moving a docked box drags the connector's end along", async ({ page }) => {
    const board = await openBoard(page, {
      elements: [
        ...boxes(),
        element({
          id: "L", data: { kind: "line", points: "0,0 180,200" }, x: 220, y: 140, width: 180, height: 200,
          fill: "transparent", stroke: "#111111", strokeWidth: 2, layerIndex: 2,
          label: `${SEP}f=A%3Aright&t=B%3Aleft`,
        }),
      ],
    });
    // Drag B by 100,50.
    await drag(page, { x: 470, y: 360 }, { x: 570, y: 410 });
    await expect.poll(
      () => board.calledWith("add_element").filter((c) => (c.args.element as Added).id === "L").length,
      { timeout: 5000 },
    ).toBeGreaterThan(0);
    const routed = board.calledWith("add_element").filter((c) => (c.args.element as Added).id === "L").at(-1)!.args.element as Added;
    expect(ends(routed)).toEqual([{ x: 220, y: 140 }, { x: 500, y: 390 }]);
    // Still docked.
    expect(extras(routed.label)).toMatchObject({ f: "A:right", t: "B:left" });
  });

  test("a line drawn in empty space docks to nothing", async ({ page }) => {
    const board = await openBoard(page, { elements: boxes() });
    await page.getByTestId("tool-line").click();
    await drag(page, { x: 600, y: 100 }, { x: 700, y: 150 });
    await expect.poll(() => board.calledWith("add_element").length).toBe(1);
    expect(extras(lastAdded(board).label)).toEqual({});
  });
});
