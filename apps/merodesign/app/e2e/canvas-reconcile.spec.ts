import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openBoard } from "./fixtures/board";
import { element, pixelAt, toHex } from "./fixtures/canvas";

/**
 * Guards the incremental canvas sync.
 *
 * The canvas used to be torn down and rebuilt (`fc.clear()` + construct every
 * element) on any change to `elements` or `imageCache`. It now reconciles. That
 * is a performance change with real behavioural teeth — object identity, paint
 * order and in-flight image loads all now matter — so the invariants it rests on
 * are asserted here, in CI, rather than only in the bench (`e2e/perf/`, which
 * prints timings and asserts nothing).
 *
 * The build/render counters these tests read are dev-only (`import.meta.env.DEV`)
 * and the suite runs against the Vite dev server, which is where they exist.
 */

const RECT = "#FF00FF";

interface Builds {
  syncs: number;
  objects: number;
}

async function resetCounters(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__canvasBuilds = { syncs: 0, objects: 0 };
    w.__renders = {};
  });
}

async function builds(page: Page): Promise<Builds> {
  return page.evaluate(
    () => (window as unknown as { __canvasBuilds?: Builds }).__canvasBuilds ?? { syncs: 0, objects: 0 },
  );
}

async function renders(page: Page): Promise<Record<string, number>> {
  return page.evaluate(
    () => (window as unknown as { __renders?: Record<string, number> }).__renders ?? {},
  );
}

/** Run a store write from outside React — what an SSE event does — and let it paint. */
async function storeWrite(page: Page, body: string): Promise<void> {
  await page.evaluate((src) => {
    const store = (window as unknown as { __canvasStore?: unknown }).__canvasStore;
    if (!store) throw new Error("__canvasStore missing — this suite needs the dev build");
    new Function("store", src)(store);
  }, body);
  await page.waitForTimeout(300);
}

/** Element ids of everything currently on the Fabric canvas, in paint order. */
async function paintOrder(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="fabric-canvas"]') as HTMLCanvasElement & {
      __fabricCanvas?: { getObjects(): { data?: { id?: string } }[] };
    };
    return (el.__fabricCanvas?.getObjects() ?? []).map((o) => o.data?.id ?? "");
  });
}

test.describe("the canvas reconciles instead of rebuilding", () => {
  test("a peer's edit rebuilds one element, not the board", async ({ page }) => {
    // The whole point of the change. Before it, this was 3.
    await openBoard(page, {
      elements: [
        element({ id: "a", x: 10, y: 10, fill: RECT }),
        element({ id: "b", x: 80, y: 10, fill: "#00AA00", layerIndex: 1 }),
        element({ id: "c", x: 150, y: 10, fill: "#0000FF", layerIndex: 2 }),
      ],
    });
    await resetCounters(page);

    await storeWrite(
      page,
      `const s = store.getState();
       const el = s.elements.find(e => e.id === "b");
       s.upsertElement({ ...el, x: el.x + 5, updatedAt: 3000 });`,
    );

    const after = await builds(page);
    expect(after.syncs).toBe(1);
    expect(after.objects).toBe(1);
  });

  test("the untouched elements keep their identity", async ({ page }) => {
    // Reuse is what makes the reconcile cheap, and it is invisible in a pixel
    // assertion: a rebuilt board looks identical. Tag the objects and check the
    // tags survive.
    await openBoard(page, {
      elements: [
        element({ id: "a", x: 10, y: 10, fill: RECT }),
        element({ id: "b", x: 80, y: 10, fill: "#00AA00", layerIndex: 1 }),
      ],
    });

    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="fabric-canvas"]') as HTMLCanvasElement & {
        __fabricCanvas?: { getObjects(): Record<string, unknown>[] };
      };
      for (const o of el.__fabricCanvas?.getObjects() ?? []) o.__tag = (o.data as { id: string }).id;
    });

    await storeWrite(
      page,
      `const s = store.getState();
       const el = s.elements.find(e => e.id === "b");
       s.upsertElement({ ...el, x: el.x + 5, updatedAt: 3000 });`,
    );

    const tags = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="fabric-canvas"]') as HTMLCanvasElement & {
        __fabricCanvas?: { getObjects(): Record<string, unknown>[] };
      };
      return (el.__fabricCanvas?.getObjects() ?? []).map((o) => ({
        id: (o.data as { id: string }).id,
        tag: o.__tag ?? null,
      }));
    });

    expect(tags.find((t) => t.id === "a")?.tag).toBe("a"); // untouched — same object
    expect(tags.find((t) => t.id === "b")?.tag).toBe(null); // edited — rebuilt
  });

  test("a late image lands at its layer index, not on top", async ({ page }) => {
    // An image finishes decoding after the synchronous shapes are placed, so it
    // used to be painted last whatever its layerIndex said. The rect is above it
    // and must win the overlap.
    await openBoard(page, {
      serveBlob: true,
      opaqueBlob: true,
      elements: [
        element({
          id: "img",
          x: 20, y: 20, width: 120, height: 120, layerIndex: 0,
          data: { kind: "image", blobId: "blob-1" },
        }),
        element({ id: "top", x: 20, y: 20, width: 120, height: 120, layerIndex: 1, fill: RECT }),
      ],
    });
    await page.waitForTimeout(600);

    expect(await paintOrder(page)).toEqual(["img", "top"]);
    expect(toHex(await pixelAt(page, 80, 80))).toBe(RECT);
  });

  test("…and still wins the overlap when it is the top layer", async ({ page }) => {
    // The control for the test above: without it, an image that failed to decode
    // would pass that assertion for the wrong reason.
    await openBoard(page, {
      serveBlob: true,
      opaqueBlob: true,
      elements: [
        element({ id: "below", x: 20, y: 20, width: 120, height: 120, layerIndex: 0, fill: RECT }),
        element({
          id: "img",
          x: 20, y: 20, width: 120, height: 120, layerIndex: 1,
          data: { kind: "image", blobId: "blob-1" },
        }),
      ],
    });
    await page.waitForTimeout(600);

    expect(await paintOrder(page)).toEqual(["below", "img"]);
    expect(toHex(await pixelAt(page, 80, 80))).not.toBe(RECT);
  });

  test("a superseded image load does not leave two objects behind", async ({ page }) => {
    // Two blobs for one element, the second arriving while the first is still
    // decoding. Without the per-element token both resolve and both get added.
    await openBoard(page, {
      serveBlob: true,
      opaqueBlob: true,
      elements: [
        element({
          id: "img",
          x: 20, y: 20, width: 80, height: 80,
          data: { kind: "image", blobId: "blob-1" },
        }),
      ],
    });
    await page.waitForTimeout(600);

    const PNG_A =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGP8z4AAT" +
      "AxDkjEqBwCbtgH9AoTPogAAAABJRU5ErkJggg==";
    await storeWrite(
      page,
      `const s = store.getState();
       s.cacheImage("img", ${JSON.stringify(PNG_A)});
       s.cacheImage("img", ${JSON.stringify(PNG_A)} + "");`,
    );
    await page.waitForTimeout(400);

    const order = await paintOrder(page);
    expect(order.filter((id) => id === "img")).toHaveLength(1);
  });

  test("a deleted element leaves the canvas", async ({ page }) => {
    // The old code got this free from `fc.clear()`. The reconcile has to do it
    // deliberately, so assert it.
    await openBoard(page, {
      elements: [
        element({ id: "a", x: 10, y: 10, fill: RECT }),
        element({ id: "b", x: 80, y: 10, fill: "#00AA00", layerIndex: 1 }),
      ],
    });

    await storeWrite(page, `store.getState().removeElement("a");`);

    expect(await paintOrder(page)).toEqual(["b"]);
  });

  test("only the layers panel re-renders when a group is collapsed", async ({ page }) => {
    // `collapsedGroups` is read by PropertiesPanel alone. Every consumer used to
    // subscribe to the whole store, so all four re-rendered.
    await openBoard(page, { elements: [element({ id: "a", x: 10, y: 10, fill: RECT })] });
    await resetCounters(page);

    await storeWrite(page, `store.getState().toggleGroupCollapsed("g-1");`);

    const counts = await renders(page);
    expect(counts.PropertiesPanel ?? 0).toBeGreaterThan(0);
    expect(counts.FabricCanvas ?? 0).toBe(0);
    expect(counts.Toolbar ?? 0).toBe(0);
    expect(counts.CanvasPage ?? 0).toBe(0);
  });
});
