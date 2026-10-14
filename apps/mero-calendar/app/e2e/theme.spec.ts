import { test, expect } from "@playwright/test";

// The theme toggle is available on the (static) landing page, so this needs no
// node mocks. It flips <html data-theme> and persists the choice to
// localStorage["mc-theme"].
test.describe("Theme toggle", () => {
  test("flips the html data-theme attribute and persists it", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");

    // ⚠️ Deliberately NOT asserted as a diff against whatever `data-theme` said
    // on arrival. Two things write that attribute — this app's ThemeProvider
    // (light unless the user saved dark) and the landing page — and what the
    // toggle actually promises is: it lands on a real theme, it persists it,
    // and pressing it again returns.
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
 * The glass palette (@calimero-apps/glass).
 *
 * The Calimero lime this app used to ship is gone: the fleet's light-glass look
 * fills primary controls with one near-black INK (near-white in dark) and uses
 * a blue ACCENT for text, icons and outlines. The app keeps its old split
 * between `--accent` (ink for text) and `--accent-fill` (a fill something sits
 * on), and this asserts the split still holds rather than trusting it.
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

test.describe("Glass palette", () => {
  test("opens light when nothing was saved, even on an OS-dark system", async ({
    browser,
  }) => {
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await context.close();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`${theme}: the accent is the glass blue, and readable on the surface`, async ({
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

      // 1. Blue, not the old lime: more blue than green, by a clear margin.
      const a = parse(accent);
      expect(a[2], `--accent ${accent} should be blue-dominant`).toBeGreaterThan(
        a[1] + 30,
      );

      // 2. The ink reads as text on both surfaces.
      expect(ratio(a, parse(bg1))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(a, parse(bg0))).toBeGreaterThanOrEqual(4.5);

      // 3. A filled control's label reads on the fill.
      expect(ratio(parse(onFill), parse(fill))).toBeGreaterThanOrEqual(4.5);
    });
  }

  /**
   * ⚠️ The regression that shipped in the first cut of the lime palette: a
   * filled control taking `background: var(--accent)` under
   * `color: var(--accent-text)`. The two legacy aliases are the same trap in
   * miniature: `--primary` is only ever a FILL, `--secondary` only ever TEXT.
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

      expect(primary, `${theme}: --primary must be the fill`).toBe(fill);
      expect(secondary, `${theme}: --secondary must be the ink`).toBe(accent);
      expect(accent, `${theme}: ink and fill are different tokens`).not.toBe(fill);

      // A label on the FILL reads.
      expect(ratio(parse(onFill), parse(fill))).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("primary buttons are filled with the glass ink", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "light");
    });
    const swatch = await page.evaluate(() => {
      const el = document.createElement("button");
      el.className = "mc-btn mc-btn--primary";
      document.body.appendChild(el);
      const s = getComputedStyle(el);
      const v = { bg: s.backgroundColor, fg: s.color, radius: s.borderRadius };
      el.remove();
      return v;
    });
    const bg = parse(swatch.bg);
    // --glass-ink is #0e1222: near-black, faintly blue. Asserted as a shape
    // rather than an exact triple so a tonal tweak does not fail it.
    expect(lum(bg)).toBeLessThan(0.02);
    expect(ratio(parse(swatch.fg), bg)).toBeGreaterThanOrEqual(4.5);
    // Pill-shaped, as every glass button is.
    expect(parseFloat(swatch.radius)).toBeGreaterThanOrEqual(18);
  });
});
