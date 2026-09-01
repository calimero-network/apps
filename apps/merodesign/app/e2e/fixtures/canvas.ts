import type { Page } from "@playwright/test";
import type { Element } from "../../src/types";

/**
 * Canvas assertions for the e2e suite.
 *
 * The existing specs assert that buttons exist. That cannot catch a shape drawn at
 * `strokeWidth: 0`, a label hidden under a bubble, or a rect painted half its size
 * off — all of which shipped. These helpers read the Fabric canvas back as pixels,
 * so a test can assert what is actually on screen.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const CANVAS = '[data-testid="fabric-canvas"]';

/** The colour at a canvas-space coordinate (zoom 1, no pan). */
export async function pixelAt(page: Page, x: number, y: number): Promise<Rgba> {
  return page.evaluate(
    ({ sel, x, y }) => {
      const c = document.querySelector(sel) as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(x, y, 1, 1).data;
      return { r: d[0], g: d[1], b: d[2], a: d[3] };
    },
    { sel: CANVAS, x: Math.round(x), y: Math.round(y) },
  );
}

export function toHex({ r, g, b }: Rgba): string {
  return (
    "#" +
    [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()
  );
}

/** True when two colours are within `tol` per channel — antialiasing tolerance. */
export function near(a: Rgba, hex: string, tol = 6): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return Math.abs(a.r - r) <= tol && Math.abs(a.g - g) <= tol && Math.abs(a.b - b) <= tol;
}

/**
 * The painted bounding box of an exact colour. Use a saturated colour that appears
 * once, or the box will span every match — pale near-whites collide with each other
 * on a white board.
 */
export async function paintedBox(
  page: Page,
  hex: string,
  tol = 2,
): Promise<{ x: number; y: number; w: number; h: number; pixels: number } | null> {
  return page.evaluate(
    ({ sel, hex, tol }) => {
      const c = document.querySelector(sel) as HTMLCanvasElement;
      const { width, height } = c;
      const d = c.getContext("2d")!.getImageData(0, 0, width, height).data;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, pixels = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4;
          if (
            Math.abs(d[i] - r) <= tol &&
            Math.abs(d[i + 1] - g) <= tol &&
            Math.abs(d[i + 2] - b) <= tol
          ) {
            pixels++;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      return pixels === 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, pixels };
    },
    { sel: CANVAS, hex, tol },
  );
}

/** How many of `samples` points along a segment differ from `bg`. */
export async function inkAlong(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  bg: string,
  samples = 12,
): Promise<number> {
  return page.evaluate(
    ({ sel, from, to, bg, samples }) => {
      const c = document.querySelector(sel) as HTMLCanvasElement;
      const ctx = c.getContext("2d")!;
      const br = parseInt(bg.slice(1, 3), 16);
      const bgc = parseInt(bg.slice(3, 5), 16);
      const bb = parseInt(bg.slice(5, 7), 16);
      let ink = 0;
      for (let i = 1; i < samples; i++) {
        const t = i / samples;
        const x = Math.round(from.x + (to.x - from.x) * t);
        const y = Math.round(from.y + (to.y - from.y) * t);
        const d = ctx.getImageData(x, y, 1, 1).data;
        if (Math.abs(d[0] - br) > 8 || Math.abs(d[1] - bgc) > 8 || Math.abs(d[2] - bb) > 8) ink++;
      }
      return ink;
    },
    { sel: CANVAS, from, to, bg, samples },
  );
}

/** Draw with a tool by dragging on the canvas. */
export async function drawWith(
  page: Page,
  tool: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  await page.locator(`[data-testid="tool-${tool}"]`).click();
  const box = (await page.locator(CANVAS).boundingBox())!;
  await page.mouse.move(box.x + from.x, box.y + from.y);
  await page.mouse.down();
  await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
  await page.mouse.up();
}

/** A minimal element, for seeding a board through the mocked contract. */
export function element(over: Partial<Element> & { id: string }): Element {
  return {
    data: { kind: "rect" },
    x: 0,
    y: 0,
    width: 40,
    height: 40,
    rotation: 0,
    fill: "#FF00FF",
    stroke: "transparent",
    strokeWidth: 0,
    opacity: 100,
    layerIndex: 0,
    createdBy: "",
    createdAt: 1770000000000,
    updatedAt: 1770000000000,
    ...over,
  } as Element;
}
