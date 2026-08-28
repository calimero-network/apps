import { test, expect } from "@playwright/test";

// The theme toggle is available on the (static) landing page, so this needs no
// node mocks. It flips <html data-theme> and persists the choice to
// localStorage["mc-theme"].
test.describe("Theme toggle", () => {
  test("flips the html data-theme attribute and persists it", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const before = await html.getAttribute("data-theme");

    await page.getByTestId("theme-toggle").first().click();

    const after = await html.getAttribute("data-theme");
    expect(after).not.toBe(before);
    expect(["light", "dark"]).toContain(after);

    // Persisted so a reload keeps the chosen theme.
    const stored = await page.evaluate(() => localStorage.getItem("mc-theme"));
    expect(stored).toBe(after);
  });
});
