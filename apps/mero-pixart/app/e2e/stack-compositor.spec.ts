import { expect, test } from "@playwright/test";

// Pixel-level proof that the on-screen StackCompositor shows what `composite`
// (export) produces. The unit suite can only compare draw SEQUENCES — its canvas
// stub has no real blending — so this runs the two compositors in real Chromium,
// on real canvases, and diffs the pixels.
//
// It is also why the view repaints whole frames. Repainting only the rectangle a
// dragged layer moved through was tried, cropped and clipped: Skia rasterises a
// transformed layer slightly differently depending on where it sits against the
// canvas edges, and this test measured the seams at up to 20/255.
//
// The one expected difference is rounding: pre-flattening the layers above the
// focus computes (A over B) over C where the reference does A over (B over C).
// Mathematically equal; in 8-bit premultiplied storage, a unit or two off.
const TOLERANCE = 3;

test("the split view matches the reference composite, pixel for pixel", async ({ page }) => {
  await page.goto("/");
  const worst = await page.evaluate(async () => {
    const path = "/src/utils/compositor.ts";
    const { composite, StackCompositor } = await import(/* @vite-ignore */ path);
    const W = 160, H = 120;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const modes = ["normal", "normal", "normal", "multiply", "screen", "overlay"];

    const sources = new Map<string, HTMLCanvasElement>();
    const layers = Array.from({ length: 24 }, (_, i) => {
      const w = 40 + Math.floor(rnd() * 120), h = 30 + Math.floor(rnd() * 90);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      const x = c.getContext("2d", { willReadFrequently: true })!;
      for (let k = 0; k < 6; k++) {
        x.fillStyle = `rgba(${rnd() * 255 | 0},${rnd() * 255 | 0},${rnd() * 255 | 0},${0.2 + rnd() * 0.8})`;
        x.fillRect(rnd() * w, rnd() * h, rnd() * w, rnd() * h);
      }
      sources.set(`s${i}`, c);
      return {
        id: `s${i}`, name: `s${i}`, kind: "raster", parentId: null, layerIndex: i,
        visible: true, locked: false, opacity: 30 + Math.floor(rnd() * 71),
        blendMode: i > 2 && rnd() < 0.25 ? modes[3 + (i % 3)] : "normal",
        x: Math.floor(rnd() * 100) - 20, y: Math.floor(rnd() * 80) - 20, width: w, height: h,
        rotation: Math.floor(rnd() * 40) - 20, scaleX: 100, scaleY: 100,
        skewX: 0, skewY: 0, flipH: false, flipV: false, warp: "",
        blobId: "", maskBlobId: null, fill: "",
        adjustments: { brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 0, invert: false },
        text: null, createdBy: "t", createdAt: 1, updatedAt: 1,
      };
    });
    const src = { sources: (id: string) => sources.get(id) ?? null, masks: () => null };
    const read = (c: HTMLCanvasElement) =>
      c.getContext("2d", { willReadFrequently: true })!.getImageData(0, 0, W, H).data;
    const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
      let m = 0;
      for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
      return m;
    };

    let worst = 0;
    // Both with only-normal layers above the focus (pre-flattened) and with a
    // blended one above it (drawn one by one): the focus runs the whole stack.
    for (const all of [layers, layers.map((l) => ({ ...l, blendMode: "normal" }))]) {
      const sc = new StackCompositor();
      for (const focus of [null, ...all.map((l) => l.id)]) {
        const ref = read(composite(all, W, H, { background: "#203040", ...src }));
        const got = read(sc.render(all, W, H, { background: "#203040", focusId: focus, ...src }));
        worst = Math.max(worst, diff(ref, got));
        // …and through a drag of the focus layer, the cached path: several
        // steps, including one far off the page and one straight back.
        let moved = all;
        for (const [dx, dy, rot] of [[17, 0, 9], [-40, 25, -3], [400, 300, 0], [-400, -300, 0], [3, 3, 45]]) {
          moved = moved.map((l) => (l.id === focus
            ? { ...l, x: l.x + dx, y: l.y + dy, rotation: l.rotation + rot } : l));
          const ref2 = read(composite(moved, W, H, { background: "#203040", ...src }));
          const got2 = read(sc.render(moved, W, H, { background: "#203040", focusId: focus, ...src }));
          worst = Math.max(worst, diff(ref2, got2));
        }
      }
    }
    return worst;
  });
  console.log(`STACK-COMPOSITOR worst channel difference: ${worst}`);
  expect(worst).toBeLessThanOrEqual(TOLERANCE);
});
