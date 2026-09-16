import { test, expect } from "@playwright/test";

// The theme toggle is available on the (static) landing page, so this needs no
// node mocks. It flips <html data-theme> and persists the choice to
// localStorage["mc-theme"].
test.describe("Theme toggle", () => {
  test("flips the html data-theme attribute and persists it", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");

    // ⚠️ Deliberately NOT asserted as a diff against whatever `data-theme` said
    // on arrival. Two things write that attribute now — this app's
    // ThemeProvider, which seeds from `prefers-color-scheme`, and the landing
    // page, which is light by default and ignores the OS. On an OS-dark runner
    // they disagree on the FIRST value, and a `not.toBe(before)` assertion
    // would then fail for a toggle that works perfectly. What the toggle
    // actually promises is: it lands on a real theme, it persists it, and
    // pressing it again returns.
    await page.getByTestId("theme-toggle").first().click();

    const after = await html.getAttribute("data-theme");
    expect(["light", "dark"]).toContain(after);

    // Persisted so a reload keeps the chosen theme.
    const stored = await page.evaluate(() => localStorage.getItem("mc-theme"));
    expect(stored).toBe(after);

    await page.getByTestId("theme-toggle").first().click();
    expect(await html.getAttribute("data-theme")).not.toBe(after);
  });
});

/**
 * The Calimero palette.
 *
 * ⚠️ Two separate promises, and the second is the one that is easy to break.
 *
 *  1. The accent is the BRAND GREEN, not the indigo this app shipped with.
 *  2. It still READS. #A5FF11 — brand-600, the signature Calimero lime — scores
 *     1.24:1 against white. As a button fill under a near-black label it is
 *     14:1 and unmistakable; as text or a 1px outline on a light surface it is
 *     invisible. So the palette splits `--accent` (ink) from `--accent-fill`,
 *     and this asserts the split holds rather than trusting that it does.
 */
type Rgb = [number, number, number];

const parse = (c: string): Rgb => {
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not a colour: ${c}`);
  const [r, g, b] = m[1].split(",").map((v) => parseFloat(v));
  return [r, g, b];
};
const lum = ([r, g, b]: Rgb) => {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** Resolve a custom property to a concrete rgb() string. */
const token = (name: string) =>
  `(() => {
     const el = document.createElement('span');
     el.style.color = getComputedStyle(document.documentElement).getPropertyValue(${JSON.stringify(name)}).trim();
     document.body.appendChild(el);
     const v = getComputedStyle(el).color;
     el.remove();
     return v;
   })()`;

test.describe("Calimero palette", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`${theme}: the accent is green, and readable on the surface`, async ({
      page,
    }) => {
      await page.goto("/");
      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
      }, theme);

      const [accent, fill, onFill, bg0, bg1] = await Promise.all(
        ["--accent", "--accent-fill", "--accent-text", "--bg-0", "--bg-1"].map(
          (n) => page.evaluate(token(n)) as Promise<string>,
        ),
      );

      // 1. Green, not blue: more green than blue, by a clear margin.
      const a = parse(accent);
      expect(a[1], `--accent ${accent} should be green-dominant`).toBeGreaterThan(
        a[2] + 30,
      );

      // 2. The ink reads as text on both surfaces.
      expect(ratio(a, parse(bg1))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(a, parse(bg0))).toBeGreaterThanOrEqual(4.5);

      // 3. A filled control's label reads on the fill. This is the pair that
      //    lets the brand lime be used at all.
      expect(ratio(parse(onFill), parse(fill))).toBeGreaterThanOrEqual(4.5);
    });
  }

  /**
   * ⚠️ The regression that shipped in the first cut of this palette.
   *
   * The split gives `--accent` to text and `--accent-fill` to fills, but every
   * filled control that was NOT `.mc-btn--primary` kept `background: var(--accent)`
   * while already carrying `color: var(--accent-text)`. That pairs near-black on
   * dark green — 3.22:1 — so the Create/Edit submit button, the selected day, the
   * "today" pill and the default event chip all went dark and hard to read at
   * once. The two legacy aliases are the same trap in miniature: `--primary` is
   * only ever a FILL, `--secondary` only ever TEXT, and aliasing both to one
   * token is what made a selected date unreadable.
   */
  test("the ink and the fill never get swapped", async ({ page }) => {
    for (const theme of ["light", "dark"] as const) {
      await page.goto("/");
      await page.evaluate((t) => {
        document.documentElement.setAttribute("data-theme", t);
      }, theme);

      const [accent, fill, onFill, primary, secondary] = await Promise.all(
        [
          "--accent",
          "--accent-fill",
          "--accent-text",
          "--primary",
          "--secondary",
        ].map((n) => page.evaluate(token(n)) as Promise<string>),
      );

      // `--primary` is a fill; `--secondary` is text. They must resolve to
      // DIFFERENT tokens in light mode, where ink and fill genuinely differ.
      expect(primary, `${theme}: --primary must be the fill`).toBe(fill);
      expect(secondary, `${theme}: --secondary must be the ink`).toBe(accent);

      // A label on the FILL reads.
      expect(ratio(parse(onFill), parse(fill))).toBeGreaterThanOrEqual(4.5);

      // And the pairing that caused the bug is only acceptable where ink and
      // fill are the same value anyway (dark mode). In light mode it must not
      // be relied on by anything — asserted here so the number is on record.
      if (accent !== fill) {
        expect(ratio(parse(onFill), parse(accent))).toBeLessThan(4.5);
      }
    }
  });

  test("primary buttons are filled with the brand lime", async ({ page }) => {
    await page.goto("/");
    const swatch = await page.evaluate(() => {
      const el = document.createElement("button");
      el.className = "mc-btn mc-btn--primary";
      document.body.appendChild(el);
      const s = getComputedStyle(el);
      const v = { bg: s.backgroundColor, fg: s.color };
      el.remove();
      return v;
    });
    const bg = parse(swatch.bg);
    // brand-600 is #A5FF11 — overwhelmingly green, with a high red channel and
    // almost no blue. Asserted as a shape rather than an exact triple so a
    // future tonal tweak does not fail a test about the palette's intent.
    expect(bg[1]).toBeGreaterThan(200);
    expect(bg[2]).toBeLessThan(120);
    expect(ratio(parse(swatch.fg), bg)).toBeGreaterThanOrEqual(4.5);
  });
});
