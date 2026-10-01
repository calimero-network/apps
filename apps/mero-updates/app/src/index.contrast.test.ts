/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// node:fs rather than the `?raw` import that lib/ephemeralOnly.test.ts uses for
// .ts sources: Vitest runs with CSS processing off, so Vite's css plugin claims
// `./index.css?raw` before the raw loader sees it and hands back an EMPTY
// STRING. Every assertion below would then pass against nothing — the worst
// possible outcome for a test whose whole job is to object.

/**
 * The theme tokens, held to WCAG AA.
 *
 * This exists because the light theme shipped with four inks that fail it, and
 * nothing said so: `--accent-ink` measured 3.7:1 on white, `--green` 3.2:1,
 * `--amber` 4.2:1 and `--text-faint` 3.3:1 — all used for small status text
 * ("19%", "2/2 broadcasting", the stat captions). Three of the four had a
 * comment above them claiming they were the legible choice.
 *
 * A colour is only legible against something, so each ink is checked against
 * the DARKEST surface it can land on, not just white.
 */

// Resolved from the Vitest root (this app's directory) rather than from
// `import.meta.url`, which Vitest does not hand back as a `file:` URL.
const CSS = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

// Guard the guard: if the read ever comes back empty, fail loudly here instead
// of letting sixteen assertions quietly succeed against "".
if (!CSS.includes("--accent-ink")) {
  throw new Error(
    "index.css did not load — the contrast checks would be vacuous",
  );
}

/** Read a token out of a `:root` block by name. Last definition in the block wins. */
function token(block: string, name: string): string {
  const scope = CSS.slice(CSS.indexOf(block) + block.length);
  const body = scope.slice(0, scope.indexOf("}"));
  const hits = [
    ...body.matchAll(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,8});`, "g")),
  ];
  if (hits.length === 0)
    throw new Error(`token --${name} not found in ${block}`);
  return hits[hits.length - 1][1];
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map(
    (i) => parseInt(full.slice(i, i + 2), 16) / 255,
  );
  const lin = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** AA for body text. Every token below is used at small sizes. */
const AA = 4.5;

describe("light theme inks", () => {
  const ROOT = ':root,\n:root[data-theme="light"] {';
  // --surface-hover is the darkest surface an ink can sit on in light mode, so
  // clearing it clears --bg and --surface too.
  const WORST = () => token(ROOT, "surface-hover");

  // These inherit whatever background the row they sit in has, so the hover
  // surface is a pairing that really happens.
  it.each(["text", "text-dim", "text-faint", "accent-ink", "green", "amber"])(
    "--%s clears AA on the darkest light surface",
    (name) => {
      expect(contrast(token(ROOT, name), WORST())).toBeGreaterThanOrEqual(AA);
    },
  );

  // --red as INK only ever appears on elements that set their own background
  // (the "live" badge sets --bg-elev), so that is the honest pairing to hold it
  // to rather than the hover surface it never lands on.
  it("--red clears AA as ink on --bg-elev", () => {
    expect(
      contrast(token(ROOT, "red"), token(ROOT, "bg-elev")),
    ).toBeGreaterThanOrEqual(AA);
  });

  it("--accent is a FILL, not an ink — text on it must be dark", () => {
    // The whole point of --accent-ink existing. If someone ever "simplifies" it
    // away to --accent, this is the check that objects.
    expect(contrast(token(ROOT, "accent"), "#ffffff")).toBeLessThan(AA);
    expect(
      contrast(token(ROOT, "accent-text"), token(ROOT, "accent")),
    ).toBeGreaterThanOrEqual(AA);
  });
});

describe("dark theme inks", () => {
  const ROOT = ':root[data-theme="dark"] {';
  const WORST = () => token(ROOT, "surface-hover");

  it.each(["text", "text-dim", "accent-ink", "green", "amber"])(
    "--%s clears AA on the darkest dark surface",
    (name) => {
      expect(contrast(token(ROOT, name), WORST())).toBeGreaterThanOrEqual(AA);
    },
  );

  it("--red clears AA as ink on --bg-elev", () => {
    expect(
      contrast(token(ROOT, "red"), token(ROOT, "bg-elev")),
    ).toBeGreaterThanOrEqual(AA);
  });
});

describe("text on a coloured FILL", () => {
  // The pairing that actually broke: `.stopBtn` painted --accent-fg (the green's
  // ink) onto the red fill. The correct ink for red FLIPS between themes, so
  // both directions are checked rather than assuming one constant works.
  it.each([
    [':root,\n:root[data-theme="light"] {'],
    [':root[data-theme="dark"] {'],
  ])("red and green fills carry a legible ink in %s", (ROOT) => {
    expect(
      contrast(token(ROOT, "red-text"), token(ROOT, "red")),
    ).toBeGreaterThanOrEqual(AA);
    expect(
      contrast(token(ROOT, "red-text"), token(ROOT, "red-hover")),
    ).toBeGreaterThanOrEqual(AA);
    expect(
      contrast(token(ROOT, "accent-text"), token(ROOT, "accent")),
    ).toBeGreaterThanOrEqual(AA);
    expect(
      contrast(token(ROOT, "accent-text"), token(ROOT, "accent-hover")),
    ).toBeGreaterThanOrEqual(AA);
  });
});
