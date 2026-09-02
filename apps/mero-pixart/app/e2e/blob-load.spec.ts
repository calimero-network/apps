import { test, expect, type Route } from "@playwright/test";
import { injectAuth, mockNode } from "./support/mocks";

// Opening a project pulls one blob per painted layer. A showcase has 14-17 of
// them, so whether those fetches overlap is the difference between "the document
// appears" and "the document appears, one layer at a time, for a couple of
// seconds" — most visible in the desktop webview.
//
// This guards the shape of the load, not its speed: with a deliberate delay on
// every blob response, a strictly sequential loader can never have more than one
// request in flight.

const LAYER_COUNT = 12;
const BLOB_DELAY_MS = 120;

/** A 1×1 transparent PNG — enough for `bytesToImage` to decode. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk"
  + "YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

function layers(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `layer-${i}`, name: `Layer ${i}`, kind: "raster", parentId: null, layerIndex: i,
    visible: true, locked: false, opacity: 100, blendMode: "normal",
    x: 0, y: 0, width: 64, height: 64, rotation: 0, scaleX: 100, scaleY: 100,
    skewX: 0, skewY: 0, flipH: false, flipV: false, warp: "",
    blobId: `blob-${i}`, maskBlobId: null,
    adjustments: {
      brightness: 0, contrast: 0, saturation: 0, hue: 0, exposure: 0, blur: 0, invert: false,
    },
    createdBy: "me", createdAt: 1, updatedAt: 1,
  }));
}

test("layer blobs are fetched concurrently, not one at a time", async ({ page }) => {
  await injectAuth(page);
  await mockNode(page, { layers: layers(LAYER_COUNT) });

  // Registered after mockNode so it wins: Playwright runs the most recently
  // added matching handler first.
  let inFlight = 0;
  let peak = 0;
  let served = 0;
  await page.route("**/admin-api/blobs/**", async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, BLOB_DELAY_MS));
    inFlight -= 1;
    served += 1;
    await route.fulfill({ status: 200, contentType: "image/png", body: PNG_1X1 });
  });

  await page.goto("/teams/team-1/projects/project-1");
  await page.getByTestId("toolbar").waitFor({ state: "visible", timeout: 15_000 });

  await expect.poll(() => served, { timeout: 20_000 }).toBe(LAYER_COUNT);

  // Sequential loading pins this at 1. Anything above it proves the fetches
  // overlap; the upper bound is the loader's own concurrency cap.
  expect(peak, "blob fetches never overlapped — the loader is serial").toBeGreaterThan(1);
  expect(peak, "more blob fetches in flight than the loader's cap").toBeLessThanOrEqual(6);
});
