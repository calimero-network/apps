import { test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { openBoard } from "../fixtures/board";
import type { Element } from "../../src/types";

/**
 * Canvas performance bench. Not a pass/fail suite — it prints numbers, so an
 * optimisation can be argued from measurements instead of intuition. Run it
 * explicitly:
 *
 *     PW_PORT=5199 pnpm exec playwright test --project=perf --reporter=list
 *
 * It is excluded from the `mocked`/`tauri` projects (and therefore from CI),
 * because timings on a shared runner are noise.
 *
 * Each scenario is the real user-visible path, not a microbenchmark:
 *
 *  - `remote update`  a peer moves one shape. SSE hands CanvasPage an
 *                     ElementUpdated, which calls `upsertElement`. Measured from
 *                     the store write to the next painted frame.
 *  - `image load`     the board opens with N image elements and their blobs
 *                     arrive one at a time — each `cacheImage` is its own store
 *                     write, exactly as `loadBlob` does it.
 *  - `re-renders`     collapsing a group in the layers panel — one field that
 *                     only that panel reads. Counted, not timed: a component
 *                     that re-renders here was subscribed to the whole store.
 *  - `select`         clicking a shape, which has to reconcile the canvas
 *                     selection against the store.
 */

const SIZES = [25, 100, 300];

function makeElements(n: number, kind: "rect" | "image" = "rect"): Element[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `el-${i}`,
    data:
      kind === "image"
        ? { kind: "image" as const, blobId: `blob-${i}`, naturalWidth: 8, naturalHeight: 8 }
        : { kind: "rect" as const },
    x: 20 + (i % 20) * 45,
    y: 20 + Math.floor(i / 20) * 45,
    width: 40,
    height: 40,
    rotation: 0,
    fill: `hsl(${(i * 37) % 360} 70% 60%)`,
    stroke: "#333333",
    strokeWidth: 1,
    opacity: 100,
    layerIndex: i,
    createdBy: "test-identity",
    createdAt: 1000,
    updatedAt: 1000,
  }));
}

/** Rebuild counters since the last reset — how much work, not just how long. */
async function builds(page: Page): Promise<{ syncs: number; objects: number }> {
  return page.evaluate(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    () => (window as any).__canvasBuilds ?? { syncs: 0, objects: 0 },
  );
}

async function resetBuilds(page: Page): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(() => ((window as any).__canvasBuilds = { syncs: 0, objects: 0 }));
}

/** Median of a sample, which is what a frame budget cares about. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

/**
 * The first samples of a run are lazy-init noise (module evaluation, the first
 * paint of a panel, Chromium's own warm-up), so they are reported separately
 * rather than folded into a percentile that then reads as steady-state jank.
 */
function report(label: string, n: number, samples: number[]): void {
  const ms = (x: number) => x.toFixed(1).padStart(7);
  const warm = samples.slice(0, 3);
  const steady = samples.slice(3);
  const sorted = [...steady].sort((a, b) => a - b);
  console.log(
    `  ${label.padEnd(16)} n=${String(n).padStart(3)}  median${ms(median(steady))}ms   ` +
      `p90${ms(sorted[Math.floor(sorted.length * 0.9)] ?? 0)}ms   ` +
      `max${ms(Math.max(...steady))}ms   ` +
      `(warm-up ${warm.map((x) => x.toFixed(0)).join("/")}ms)`,
  );
}

/**
 * Time a store write through to the frame that shows it. Two rAFs: the first
 * fires before React has flushed, the second after the canvas has painted.
 */
async function timeStoreWrite(page: Page, write: string, reps: number): Promise<number[]> {
  return page.evaluate(
    async ({ write, reps }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const store = (window as any).__canvasStore;
      if (!store) throw new Error("__canvasStore missing — is the dev build running?");
      const apply = new Function("store", "i", write) as (s: unknown, i: number) => void;
      const painted = () =>
        new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));

      const out: number[] = [];
      for (let i = 0; i < reps; i++) {
        await painted();
        const t0 = performance.now();
        apply(store, i);
        await painted();
        out.push(performance.now() - t0);
      }
      return out;
    },
    { write, reps },
  );
}

test.describe("canvas bench", () => {
  test.setTimeout(180_000);

  test("remote element update", async ({ page }) => {
    console.log("\nremote update — one peer moves one shape (upsertElement)");
    console.log("  (16.7ms is the measurement floor: two rAFs at 60Hz)");
    for (const n of SIZES) {
      await openBoard(page, { elements: makeElements(n) });
      await resetBuilds(page);
      const samples = await timeStoreWrite(
        page,
        `const s = store.getState();
         const el = s.elements[0];
         s.upsertElement({ ...el, x: el.x + (i % 2 ? 1 : -1), updatedAt: 2000 + i });`,
        30,
      );
      report("remote update", n, samples);
      const b = await builds(page);
      console.log(`    ${b.syncs} canvas rebuilds, ${b.objects} Fabric objects built for 30 updates`);
    }
  });

  test("image blobs arriving", async ({ page }) => {
    console.log("\nimage load — blobs land one at a time (cacheImage per blob)");
    const PNG =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAFElEQVR4nGP8z4AAT" +
      "AxDkjEqBwCbtgH9AoTPogAAAABJRU5ErkJggg==";
    for (const n of [10, 25, 50]) {
      await openBoard(page, { elements: makeElements(n, "image"), serveBlob: true });
      await resetBuilds(page);
      const samples = await timeStoreWrite(
        page,
        `store.getState().cacheImage("el-" + i, ${JSON.stringify(PNG)});`,
        n,
      );
      const total = samples.reduce((a, b) => a + b, 0);
      report("blob arrival", n, samples);
      const b = await builds(page);
      console.log(
        `    total to load all ${n}: ${total.toFixed(0)}ms  ` +
          `(${b.syncs} rebuilds, ${b.objects} Fabric objects built)`,
      );
    }
  });

  test("wasted re-renders", async ({ page }) => {
    // Collapsing a group in the layers panel is the cleanest probe: it writes one
    // field (`collapsedGroups`) that only the panel reads. Anything else that
    // re-renders was subscribed to the whole store rather than to what it uses.
    console.log("\nre-renders — 10 group collapses, which only the layers panel cares about");
    for (const n of SIZES) {
      await openBoard(page, { elements: makeElements(n) });
      await page.evaluate(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__renders = {};
      });
      await timeStoreWrite(page, `store.getState().toggleGroupCollapsed("g-" + (i % 2));`, 10);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const renders = await page.evaluate(() => (window as any).__renders ?? {});
      const shown = Object.entries(renders as Record<string, number>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join("  ");
      console.log(`  n=${String(n).padStart(3)}  ${shown}`);
    }
  });

  test("selecting a shape", async ({ page }) => {
    console.log("\nselect — clicking one shape on the canvas");
    for (const n of SIZES) {
      await openBoard(page, { elements: makeElements(n) });
      await resetBuilds(page);
      const samples = await timeStoreWrite(
        page,
        `store.getState().selectElement(i % 2 ? "el-1" : "el-0");`,
        30,
      );
      report("select", n, samples);
      const b = await builds(page);
      console.log(`    ${b.syncs} canvas rebuilds, ${b.objects} Fabric objects built for 30 selections`);
    }
  });
});
