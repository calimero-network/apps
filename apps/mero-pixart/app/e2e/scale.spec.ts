import { test } from "@playwright/test";
import { injectAuth, mockNode } from "./support/mocks";

// How the editor holds up as a document accumulates elements.
//
// Read scripts/perf-scale.html first: the compositor itself is not the worry —
// a 400-element document flattens in 2.7ms with a warm prepared cache. What this
// file measures is the whole per-gesture path in the real app, in a REAL BUILD.
//
// Two methodology notes, both learned the hard way:
//
//   • Run this against a production build, not `vite dev`. Dev-mode React
//     (jsxDEV, validateProperty, runWithFiberInDEV) dominates the profile and
//     made panning look like it scaled 5.4x with layer count when in a real
//     build it does not scale at all. To reproduce:
//         pnpm build && pnpm exec vite preview --port 5200 --strictPort
//         PW_PORT=5200 pnpm exec playwright test e2e/scale.spec.ts
//
//   • Neither obvious way of timing a gesture works. Timing the dispatch alone
//     measures ~0.01ms, because React batches a continuous event and does the
//     render + canvas draw before the next paint. Putting a frame between events
//     and timing that measures the DISPLAY — every result floors at 8.3ms on a
//     120Hz panel. So `msPerMove` runs the same frame loop twice, idle and
//     driving the gesture, and subtracts.

// These gates are meaningless against `vite dev`: dev-mode React (jsxDEV,
// validateProperty, runWithFiberInDEV) costs several times the real thing, and
// panning "scales" 5.4x with layer count purely because of it. So the suite only
// runs when pointed at a production build, which the default `pnpm e2e` is not.
//
//   pnpm build && pnpm exec vite preview --port 5200 --strictPort &
//   PERF_PROD=1 PW_PORT=5200 pnpm exec playwright test e2e/scale.spec.ts --project=mocked
test.skip(
  !process.env.PERF_PROD,
  "perf gates need a production build — set PERF_PROD=1 (see the header comment)",
);

const LOW = 10;
const HIGH = 400;
// One frame at 60Hz. The gate is the ABSOLUTE per-move cost at HIGH, not the
// ratio: the LOW baseline lands near zero and dividing by it swings between 100x
// and 1600x run to run, which is a coin toss, not a signal. Current cost at 400
// elements is ~0.8ms panning and ~2.9ms painting, so this has real headroom and
// only fires on a genuine regression.
const FRAME_BUDGET_MS = 16.7;

function layers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `el-${i}`, name: `Element ${i}`, kind: "raster", parentId: null, layerIndex: i,
    visible: true, locked: false, opacity: 100, blendMode: "normal",
    x: (i * 53) % 700, y: (i * 89) % 500, width: 96, height: 96,
    rotation: 0, scaleX: 100, scaleY: 100,
    skewX: 0, skewY: 0, flipH: false, flipV: false, warp: "",
    blobId: "", maskBlobId: null,
    adjustments: {
      brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 0, invert: false,
    },
    createdBy: "me", createdAt: 1, updatedAt: 1,
  }));
}

type Page = import("@playwright/test").Page;

async function openWith(page: Page, n: number) {
  await injectAuth(page);
  await mockNode(page, { layers: layers(n), doc: { width: 1400, height: 1800 } });
  await page.goto(`/teams/team-1/projects/project-${n}`);
  await page.getByTestId("toolbar").waitFor({ state: "visible", timeout: 20_000 });
}

/**
 * Main-thread work one pointermove of a drag actually costs, in ms.
 *
 * React batches a continuous event, so the handler returns almost instantly and
 * the render + canvas draw land before the next paint. Timing the dispatch alone
 * measures nothing (0.01ms); putting a frame between events and timing that
 * measures the display (8.3ms on 120Hz ProMotion) and floors everything under it.
 *
 * So: run the same frame loop twice, once idle and once driving the gesture, and
 * take the difference. What is left is the work, with vsync cancelled out.
 */
async function msPerMove(page: Page, moves: number): Promise<number> {
  return page.evaluate(async (n) => {
    const el = document.querySelector('[data-testid="main-canvas"]')!;
    const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
    const fire = (type: string, i: number) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, clientX: 300 + (i % 240), clientY: 260 + ((i * 7) % 180),
      pointerId: 1, buttons: 1, isPrimary: true,
    }));

    const run = async (withWork: boolean) => {
      if (withWork) fire("pointerdown", 0);
      await frame();
      const t = performance.now();
      for (let i = 1; i <= n; i++) {
        if (withWork) fire("pointermove", i);
        await frame();
      }
      const dt = performance.now() - t;
      if (withWork) fire("pointerup", n);
      return dt;
    };

    const idle = await run(false);
    const busy = await run(true);
    return Math.max(0, busy - idle) / n;
  }, moves);
}

/** Run a gesture at both sizes; returns the per-move cost at HIGH. */
async function compare(page: Page, label: string, prep: (p: Page) => Promise<void>) {
  const at: Record<number, number> = {};
  for (const n of [LOW, HIGH]) {
    await openWith(page, n);
    await prep(page);
    await msPerMove(page, 20);           // warm
    at[n] = await msPerMove(page, 60);
  }
  console.log(`SCALE ${label}: ${LOW} elements=${at[LOW].toFixed(3)}ms/move  `
    + `${HIGH} elements=${at[HIGH].toFixed(3)}ms/move`);
  return at[HIGH];
}

test("panning does not get more expensive as elements pile up", async ({ page }) => {
  test.setTimeout(180_000);
  const cost = await compare(page, "pan", async (p) => {
    await p.keyboard.down("Space");      // space-drag is the pan gesture
  });
  // A pan writes panX/panY and nothing else, yet it still costs more with more
  // layers, because the redraw re-blits every one of them. It must at least stay
  // inside a frame.
  if (cost >= FRAME_BUDGET_MS) {
    throw new Error(
      `panning costs ${cost.toFixed(1)}ms/move with ${HIGH} elements, over the `
      + `${FRAME_BUDGET_MS}ms frame budget`);
  }
});

test("moving the view around stays cheap", async ({ page }) => {
  test.setTimeout(180_000);
  // Panning and zooming change nothing about the document — no layer moves, no
  // pixel changes, the flattened-document cache hits. All that should happen is
  // re-blitting one cached canvas. This caught the transparency checkerboard
  // being redrawn square by square (~40,000 fillRect per frame on a 1400x1800
  // document), which is why moving the view felt heavy no matter how empty the
  // document was.
  const at: Record<string, number> = {};
  for (const n of [LOW, HIGH]) {
    await openWith(page, n);
    at[`pan${n}`] = await (async () => {
      await page.keyboard.down("Space");
      await msPerMove(page, 20);
      const v = await msPerMove(page, 60);
      await page.keyboard.up("Space");
      return v;
    })();
    at[`zoom${n}`] = await page.evaluate(async () => {
      const el = document.querySelector('[data-testid="main-canvas"]')!;
      const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));
      const run = async (withWork: boolean) => {
        await frame();
        const t = performance.now();
        for (let i = 1; i <= 60; i++) {
          if (withWork) {
            el.dispatchEvent(new WheelEvent("wheel", {
              bubbles: true, cancelable: true, ctrlKey: true,
              deltaY: i % 2 ? -40 : 40, clientX: 400, clientY: 300,
            }));
          }
          await frame();
        }
        return performance.now() - t;
      };
      const idle = await run(false);
      const busy = await run(true);
      return Math.max(0, busy - idle) / 60;
    });
  }
  console.log(`SCALE view: pan ${LOW}=${at[`pan${LOW}`].toFixed(3)}ms `
    + `${HIGH}=${at[`pan${HIGH}`].toFixed(3)}ms | `
    + `zoom ${LOW}=${at[`zoom${LOW}`].toFixed(3)}ms ${HIGH}=${at[`zoom${HIGH}`].toFixed(3)}ms`);

  for (const [k, v] of Object.entries(at)) {
    if (v >= FRAME_BUDGET_MS) {
      throw new Error(`${k} costs ${v.toFixed(1)}ms/move, over the ${FRAME_BUDGET_MS}ms frame budget`);
    }
  }
});

test("painting does not get more expensive as elements pile up", async ({ page }) => {
  test.setTimeout(180_000);
  const cost = await compare(page, "brush", async (p) => {
    await p.getByTestId("tool-brush").click().catch(() => { /* default tool is fine */ });
    await p.getByTestId(`layer-row-el-0`).click().catch(() => { /* already selected */ });
  });
  // A brush dab touches one layer's pixels and recomposites once — but that
  // recomposite still walks every layer, so this is the gesture that degrades
  // first as a document fills up.
  if (cost >= FRAME_BUDGET_MS) {
    throw new Error(
      `painting costs ${cost.toFixed(1)}ms/move with ${HIGH} elements, over the `
      + `${FRAME_BUDGET_MS}ms frame budget`);
  }
});
