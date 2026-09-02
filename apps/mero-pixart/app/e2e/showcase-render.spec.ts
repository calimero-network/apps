import { test, expect } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { SHOWCASE_PROJECTS } from "../src/showcase";

// Renders every bundled showcase at full resolution in a real browser and writes
// the PNGs to `e2e-artifacts/`, which CI uploads.
//
// Two jobs in one:
//   • a regression gate — the unit suite can only check the recipes through a
//     canvas stub, so this is the only place the actual pixels are produced;
//   • reviewable evidence — a change to a recipe, to the warp mesh or to the
//     compositor shows up as an image a reviewer can look at, without anyone
//     having to boot a node and create a project.

const OUT = "e2e-artifacts";

test("every showcase renders to a real image", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto("/scripts/showcase-preview.html");
  await page.waitForFunction(
    () => (window as unknown as { __SHOWCASE_READY__?: boolean }).__SHOWCASE_READY__ === true,
    undefined,
    { timeout: 60_000 },
  );

  const pngs = await page.evaluate(
    () => (window as unknown as { __SHOWCASE_PNGS__: Record<string, string> }).__SHOWCASE_PNGS__,
  );

  expect(Object.keys(pngs).sort()).toEqual(SHOWCASE_PROJECTS.map((p) => p.id).sort());
  mkdirSync(OUT, { recursive: true });

  for (const project of SHOWCASE_PROJECTS) {
    const dataUrl = pngs[project.id];
    expect(dataUrl.startsWith("data:image/png;base64,"), project.id).toBe(true);
    const bytes = Buffer.from(dataUrl.split(",")[1], "base64");
    // A blank canvas of this size still encodes small; anything with real artwork
    // on it does not. 40 kB is comfortably below every current project and well
    // above an empty one.
    expect(bytes.byteLength, `${project.id} looks empty`).toBeGreaterThan(40_000);
    writeFileSync(`${OUT}/${project.id}.png`, bytes);
  }

  expect(errors, "the render logged errors").toEqual([]);
});

test("each showcase's own canvas matches its declared size", async ({ page }) => {
  await page.goto("/scripts/showcase-preview.html");
  await page.waitForFunction(
    () => (window as unknown as { __SHOWCASE_READY__?: boolean }).__SHOWCASE_READY__ === true,
    undefined,
    { timeout: 60_000 },
  );
  const sizes = await page.evaluate(() => {
    const pngs = (window as unknown as { __SHOWCASE_PNGS__: Record<string, string> }).__SHOWCASE_PNGS__;
    return Promise.all(Object.entries(pngs).map(([id, url]) => new Promise<[string, number, number]>((resolve) => {
      const img = new Image();
      img.onload = () => resolve([id, img.naturalWidth, img.naturalHeight]);
      img.src = url;
    })));
  });
  for (const [id, w, h] of sizes) {
    const project = SHOWCASE_PROJECTS.find((p) => p.id === id)!;
    expect([w, h], id).toEqual([project.width, project.height]);
  }
});
