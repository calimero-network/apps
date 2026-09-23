import { expect, test, type Page } from "@playwright/test";
import { injectAuth, mockNode } from "./support/mocks";

// The document people actually build: start empty, press "New raster layer"
// forty times, paint something on each one. Then zoom, pan, paint and drag.
//
// `scale.spec.ts` looks like it covers this and does not. Its 400 elements are
// 96px squares with no pixels (`blobId: ""` → no canvas in the registry), so
// every per-layer cost that depends on a layer HAVING pixels is invisible to it
// — and that is exactly where a 40-layer document went wrong:
//
//   • the Layers panel re-encoded every layer's full-resolution canvas as a PNG
//     for its thumbnail on EVERY re-render (~190ms for 40 layers), and it
//     re-rendered on every zoom and pan step because it subscribed to the whole
//     editor store;
//   • a brush dab or a drag recomposited all forty document-sized layers, where
//     only the one being edited had changed.
//
// Same methodology as scale.spec.ts, and for the same reasons: run against a
// production build (dev-mode React swamps the numbers), and time a gesture as
// (frame loop driving it) − (identical idle frame loop), per event.
//
//   pnpm build && pnpm exec vite preview --port 5200 --strictPort &
//   PERF_PROD=1 PW_PORT=5200 pnpm exec playwright test e2e/many-layers.spec.ts --project=mocked
test.skip(
  !process.env.PERF_PROD,
  "perf gates need a production build — set PERF_PROD=1 (see the header comment)",
);

const LAYERS = 40;
const FRAME_BUDGET_MS = 16.7;

async function openEmpty(page: Page) {
  await injectAuth(page);
  await mockNode(page, { layers: [], doc: { width: 1280, height: 720 } });
  await page.goto("/teams/team-1/projects/project-many");
  await page.getByTestId("toolbar").waitFor({ state: "visible", timeout: 20_000 });
}

/** Add LAYERS raster layers through the panel and paint a stroke on each. */
async function buildDocument(page: Page) {
  const add = page.getByRole("button", { name: "New raster layer" });
  await page.getByTestId("tool-brush").click();
  const box = (await page.getByTestId("main-canvas").boundingBox())!;
  for (let i = 0; i < LAYERS; i++) {
    await add.click(); // the new layer is selected, so the stroke lands on it
    const y = box.y + 40 + ((i * 13) % Math.max(1, box.height - 80));
    await page.mouse.move(box.x + 60, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, y + 20, { steps: 4 });
    await page.mouse.move(box.x + box.width - 60, y, { steps: 4 });
    await page.mouse.up();
  }
  await expect(page.locator('[data-testid^="layer-row-"]')).toHaveCount(LAYERS);
}

/**
 * Main-thread CPU ms per event of a gesture.
 *
 * Not wall-clock. Frame-loop timing (what scale.spec.ts does) floors at vsync:
 * (busy − idle) only sees the part of the work that spills PAST a frame, so
 * anything under 16.7ms reads as 0 and a gate on it says nothing about the
 * margin. Chrome's own `TaskDuration` metric is the main thread's accumulated
 * busy time — every React render, effect and canvas draw the gesture triggered —
 * so the same (busy − idle) difference is the real cost, vsync or not.
 */
async function msPer(page: Page, kind: "pointer" | "wheel", n: number): Promise<number> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const taskSeconds = async () => {
    const { metrics } = await cdp.send("Performance.getMetrics");
    return metrics.find((m) => m.name === "TaskDuration")!.value;
  };
  const run = (work: boolean) => page.evaluate(async ({ kind, n, work }) => {
    const el = document.querySelector('[data-testid="main-canvas"]')!;
    const r = el.getBoundingClientRect();
    const frame = () => new Promise((res) => requestAnimationFrame(() => res(null)));
    const at = (i: number) => ({
      clientX: r.left + 200 + (i % 240), clientY: r.top + 160 + ((i * 7) % 180),
    });
    const ptr = (type: string, i: number) => el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 1, buttons: 1, isPrimary: true, ...at(i),
    }));
    if (work && kind === "pointer") ptr("pointerdown", 0);
    await frame();
    for (let i = 1; i <= n; i++) {
      if (work) {
        if (kind === "pointer") ptr("pointermove", i);
        else el.dispatchEvent(new WheelEvent("wheel", {
          bubbles: true, cancelable: true, ctrlKey: true,
          deltaY: i % 2 ? -40 : 40, ...at(0),
        }));
      }
      await frame();
    }
    if (work && kind === "pointer") ptr("pointerup", n);
    await frame();
  }, { kind, n, work });

  let t = await taskSeconds();
  await run(false);
  const idle = (await taskSeconds()) - t;
  t = await taskSeconds();
  await run(true);
  const busy = (await taskSeconds()) - t;
  await cdp.detach();
  return (Math.max(0, busy - idle) * 1000) / n;
}

test(`a ${LAYERS}-layer painted document stays inside a frame`, async ({ page }) => {
  test.setTimeout(240_000);
  await openEmpty(page);
  await buildDocument(page);

  const cost: Record<string, number> = {};

  await msPer(page, "wheel", 10);
  cost.zoom = await msPer(page, "wheel", 60);

  await page.keyboard.down("Space");
  await msPer(page, "pointer", 10);
  cost.pan = await msPer(page, "pointer", 60);
  await page.keyboard.up("Space");

  // Paint on a layer in the MIDDLE of the stack: twenty painted layers below it,
  // nineteen above — the worst case for anything that recomposites the stack.
  await page.locator('[data-testid^="layer-row-"]').nth(LAYERS / 2).click();
  await page.getByTestId("tool-brush").click();
  await msPer(page, "pointer", 10);
  cost.paint = await msPer(page, "pointer", 60);

  await page.getByTestId("tool-move").click();
  await msPer(page, "pointer", 10);
  cost.move = await msPer(page, "pointer", 60);

  console.log(`MANY-LAYERS (${LAYERS}): ` + Object.entries(cost)
    .map(([k, v]) => `${k}=${v.toFixed(2)}ms`).join("  "));

  for (const [k, v] of Object.entries(cost)) {
    expect(v, `${k} costs ${v.toFixed(1)}ms/event with ${LAYERS} painted layers`)
      .toBeLessThan(FRAME_BUDGET_MS);
  }
});

// The bundled starter documents — the first thing anyone opens, and where the
// lag was first reported. Up to 1680×1000, 20+ layers each, folders, blends,
// blurs and warps.
for (const id of ["aurora", "ridge", "bauhaus", "transform-lab"]) {
  test(`the ${id} showcase stays inside a frame`, async ({ page }) => {
    test.setTimeout(120_000);
    await openEmpty(page);
    await page.getByRole("button", { name: "File" }).click();
    await page.getByTestId("menu-open-showcase").click();
    await page.getByTestId(`showcase-open-${id}`).click();
    await expect(page.getByTestId("showcase-picker")).toHaveCount(0);
    const rows = page.locator('[data-testid^="layer-row-"]:not([data-kind="group"])');
    await expect(rows.first()).toBeVisible();

    const cost: Record<string, number> = {};
    await msPer(page, "wheel", 10);
    cost.zoom = await msPer(page, "wheel", 60);
    await page.keyboard.down("Space");
    await msPer(page, "pointer", 10);
    cost.pan = await msPer(page, "pointer", 60);
    await page.keyboard.up("Space");
    await rows.nth(Math.floor((await rows.count()) / 2)).click();
    await page.getByTestId("tool-move").click();
    await msPer(page, "pointer", 10);
    cost.move = await msPer(page, "pointer", 60);

    console.log(`SHOWCASE ${id}: ` + Object.entries(cost)
      .map(([k, v]) => `${k}=${v.toFixed(2)}ms`).join("  "));
    // Dragging gets two frames, not one. The dragged layer here is the middle
    // row, and in Aurora that is Glare: a live perspective warp (a 288-triangle
    // mesh) on Screen blend, under two full-page blend layers (Grain on
    // Overlay, Vignette on Multiply) that cannot be pre-flattened — "over" is
    // associative, blend modes are not. That is real pixel work on a CPU
    // canvas: measured 16–19ms here (192ms before), Ridge/Bauhaus ~12ms.
    for (const [k, v] of Object.entries(cost)) {
      const budget = k === "move" ? 2 * FRAME_BUDGET_MS : FRAME_BUDGET_MS;
      expect(v, `${k} costs ${v.toFixed(1)}ms/event in ${id}`).toBeLessThan(budget);
    }
  });
}
