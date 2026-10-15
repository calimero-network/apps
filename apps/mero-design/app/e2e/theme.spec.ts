import { test, expect, type Page } from "@playwright/test";
import { openBoard } from "./fixtures/board";

/**
 * The in-app light/dark switch: light by default, `data-theme="dark"` on <html>
 * when chosen, remembered in localStorage and applied before the first paint on
 * the next load.
 */

async function openTeams(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("mero-tokens", JSON.stringify({
      access_token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LWlkZW50aXR5In0.sig",
      refresh_token: "fake-refresh",
      expires_at: Date.now() + 3600_000,
      node_origin: "http://localhost:2430", // mero-js ignores a bundle bound to no node
    }));
    localStorage.setItem("mero:node_url", "http://localhost:2430");
    localStorage.setItem("mero:application_id", "app-1");
  });
  await page.route("**/auth/validate", (route) => route.fulfill({ status: 200 }));
  await page.route("**/admin-api/namespaces**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: [] }) }),
  );
  await page.goto("/teams");
  // No teams on this node: the shell's first-team start.
  await expect(page.getByRole("heading", { name: "Start your first team" })).toBeVisible({ timeout: 8000 });
}

const htmlTheme = (page: Page) => page.evaluate(() => document.documentElement.getAttribute("data-theme"));

test.describe("theme switch", () => {
  test("is light by default", async ({ page }) => {
    await openTeams(page);
    expect(await htmlTheme(page)).toBeNull();
    await expect(page.getByRole("button", { name: "Use dark theme" })).toBeVisible();
    // The glass ground really is the light one.
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(246, 247, 251)");
  });

  test("switches to dark and back, and the choice survives a reload", async ({ page }) => {
    await openTeams(page);
    await page.getByRole("button", { name: "Use dark theme" }).click();
    expect(await htmlTheme(page)).toBe("dark");
    expect(await page.evaluate(() => localStorage.getItem("mero-design:theme"))).toBe("dark");
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(11, 14, 24)");

    await page.reload();
    // Applied by index.html before React mounts, so there is no light flash.
    expect(await htmlTheme(page)).toBe("dark");
    await expect(page.getByRole("button", { name: "Use light theme" })).toBeVisible({ timeout: 8000 });

    await page.getByRole("button", { name: "Use light theme" }).click();
    expect(await htmlTheme(page)).toBeNull();
    await page.reload();
    await expect(page.getByRole("button", { name: "Use dark theme" })).toBeVisible({ timeout: 8000 });
    expect(await htmlTheme(page)).toBeNull();
  });

  test("the board follows the theme, and the shell's top bar has the switch", async ({ page }) => {
    await openBoard(page);
    const boardPixel = () => page.evaluate(() => {
      const c = document.querySelector('[data-testid="fabric-canvas"]') as HTMLCanvasElement;
      const d = c.getContext("2d")!.getImageData(5, 5, 1, 1).data;
      return [d[0], d[1], d[2]];
    });
    const light = await boardPixel();
    expect(Math.min(...light)).toBeGreaterThan(240);

    await page.getByRole("button", { name: "Use dark theme" }).click();
    await expect.poll(async () => Math.max(...(await boardPixel()))).toBeLessThan(60);
  });
});
