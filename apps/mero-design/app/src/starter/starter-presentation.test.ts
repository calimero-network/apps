import { describe, it, expect } from "vitest";
import raw from "./starter-presentation.json?raw";
import { validateSnapshot } from "../utils/projectFile";
import { elementsInScreen, fitScreen, listScreens } from "../utils/screens";
import { STARTERS } from "./starters";
import type { Element } from "../types";

/**
 * Guards the presentation starter: a deck about Calimero, built as screens.
 * Regenerate with `node scripts/build-starter-presentation.mjs`.
 */
const snapshot = JSON.parse(raw) as { elements: Element[]; comments: unknown[]; boardName: string };
const screens = listScreens(snapshot.elements);

describe("the presentation starter", () => {
  it("passes the same validator the import path uses", () => {
    expect(validateSnapshot(snapshot)).toBe(true);
  });

  it("is offered in the menu next to the web design starter", () => {
    expect(STARTERS.map((s) => s.id)).toEqual(["web", "presentation"]);
  });

  it("plays eight slides, in order", () => {
    expect(screens.map((s) => s.name)).toEqual([
      "Calimero", "The problem", "How it works", "Building blocks",
      "For developers", "Already running", "One edit, end to end", "Get started",
    ]);
  });

  it("is 16:9 slides, except one tall screen that scrolls", () => {
    const tall = screens.filter((s) => s.height !== 1080);
    expect(tall.map((s) => s.name)).toEqual(["One edit, end to end"]);
    for (const s of screens) expect(s.width).toBe(1920);
    expect(fitScreen(tall[0].width, tall[0].height, 1440, 800).scrolls).toBe(true);
    expect(fitScreen(1920, 1080, 1440, 800).scrolls).toBe(false);
  });

  it("puts every element on a slide — nothing floats on the board between them", () => {
    const onSlides = new Set(screens.flatMap((s) => elementsInScreen(snapshot.elements, s).map((e) => e.id)));
    expect(snapshot.elements.filter((e) => !onSlides.has(e.id)).map((e) => e.id)).toEqual([]);
  });

  it("keeps every element inside its slide's edge", () => {
    for (const el of snapshot.elements) {
      const home = screens.find((s) => elementsInScreen([el], s).length > 0)!;
      expect(el.x, el.id).toBeGreaterThanOrEqual(home.x);
      expect(el.y, el.id).toBeGreaterThanOrEqual(home.y);
      expect(el.x + el.width, el.id).toBeLessThanOrEqual(home.x + home.width);
      expect(el.y + el.height, el.id).toBeLessThanOrEqual(home.y + home.height);
    }
  });

  it("uses only kinds the renderer supports, with unique ids", () => {
    const kinds = new Set(snapshot.elements.map((e) => e.data.kind));
    for (const k of kinds) expect(["rect", "circle", "text", "line", "arrow"]).toContain(k);
    expect(new Set(snapshot.elements.map((e) => e.id)).size).toBe(snapshot.elements.length);
  });

  it("keeps its code sample indented — the slide must show what the board shows", () => {
    const code = snapshot.elements.find((e) => e.data.kind === "text" && (e.data.content ?? "").includes("impl Board"));
    expect(code?.data.content).toContain("\n    pub fn add_element");
  });
});
