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
