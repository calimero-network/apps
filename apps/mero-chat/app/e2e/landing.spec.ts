import { test, expect } from "@playwright/test";

/**
 * mero-chat's own landing behaviour. The page's CONTENT is the shared template
 * and is covered by the generated marketing-landing.spec.ts; what is specific
 * to this app is covered here: its routes (`/login` is still the front door,
 * because `/` is the app itself) and the interactive chat in the hero.
 */
test.describe("Landing page (unauthenticated)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    // Absorbs Vite's first-request compilation and provider init.
    await expect(page.getByRole("heading", { level: 1, name: "Mero Chat" })).toBeVisible({
      timeout: 20_000,
    });
  });

  test("redirects to /login when no auth tokens are present", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("unknown routes redirect to /login", async ({ page }) => {
    await page.goto("/nonexistent-path");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });

  test("Connect to node opens the node picker", async ({ page }) => {
    await page.getByRole("button", { name: /connect to node/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
  });

  test("/docs and /preview open cold", async ({ page }) => {
    await page.goto("/docs");
    await expect(page.locator("#concepts")).toBeVisible({ timeout: 20_000 });
    await page.goto("/preview");
    await expect(page.locator(".cal-lp-beats")).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Hero: the chat you can click around", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" }); // no idle loop: deterministic
    await page.goto("/login");
    await expect(page.getByRole("navigation", { name: "Channels" })).toBeVisible({ timeout: 20_000 });
  });

  test("switching channels shows that channel's conversation", async ({ page }) => {
    await expect(page.getByText("RC1 is building.")).toBeVisible();
    await page.getByRole("button", { name: /Private channel leadership/ }).click();
    await expect(page.getByText(/Only this channel can see it/)).toBeVisible();
    await expect(page.getByText("RC1 is building.")).toHaveCount(0);
  });

  test("sending a message shows it, then a teammate types and replies", async ({ page }) => {
    const box = page.getByRole("textbox", { name: "Message #general" });
    await box.fill("Shipping Tuesday!");
    await box.press("Enter");
    await expect(page.getByText("Shipping Tuesday!")).toBeVisible();
    await expect(page.getByText(/is typing…/)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("Nice, thanks!")).toBeVisible({ timeout: 5_000 });
  });

  test("a reaction toggles on and off", async ({ page }) => {
    const add = page.getByRole("button", { name: /Add 🚀 reaction, 3 so far/ });
    await add.click();
    const remove = page.getByRole("button", { name: /Remove 🚀 reaction, 4 so far/ });
    await expect(remove).toHaveAttribute("aria-pressed", "true");
    await remove.click();
    await expect(page.getByRole("button", { name: /Add 🚀 reaction, 3 so far/ })).toBeVisible();
  });
});
