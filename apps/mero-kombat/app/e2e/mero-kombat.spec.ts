/**
 * The arena, against a real node.
 *
 * One node can open an arena, take a corner and mint an invitation, but it
 * cannot fight: the contract refuses one person in both corners. The fight
 * itself — blows as transactions, health both nodes derive — is the two-node
 * story in e2e/journey and logic/workflows/fight-a-match.yml.
 */
import { expect, test } from "@playwright/test";
import { btn, login, status, waitForArena, watchForErrors } from "./helpers";

test.describe("Mero Kombat", () => {
  test("opens an arena and takes a corner", async ({ page }) => {
    const errors = watchForErrors(page);
    await login(page);
    await waitForArena(page);
    await expect(status(page)).toHaveText("Waiting for fighters");
    await expect(page.getByTestId("corner-p1")).toContainText("Open corner");

    await page.getByLabel("your name").fill("Ada");
    await page.getByRole("radio", { name: "JINZO", exact: true }).click();
    await page.getByTestId("sit-p1").click();
    await expect(page.getByTestId("corner-p1")).toContainText("Ada");
    await expect(page.getByTestId("corner-p1")).toContainText("JINZO");
    await expect(page.getByTestId("corner-p1")).toContainText("you");
    // One person cannot take the other corner as well.
    await expect(page.getByTestId("sit-p2")).toHaveCount(0);
    await expect(status(page)).toHaveText("Waiting for fighters");
    // Switching fighter once seated is its own transaction.
    await page.getByRole("radio", { name: "CRYO", exact: true }).click();
    await expect(page.getByTestId("corner-p1")).toContainText("CRYO");

    errors.assertClean();
  });

  test("shows the chain meter before any blow", async ({ page }) => {
    await login(page);
    await waitForArena(page);
    await expect(page.getByTestId("tps")).toHaveText("0.0");
    await expect(page.getByTestId("arena-tx")).toHaveText("0");
  });

  test("mints an invitation for the arena", async ({ page }) => {
    await login(page);
    await waitForArena(page);
    await btn(page, "Create invite link").click();
    const link = page.locator(".invite-link");
    await expect(link).toBeVisible();
    await expect(link).toContainText("com.calimero.mero-kombat");
    await expect(link).toContainText("invitation=");
  });

  test("offers the arena picker when the session names no context", async ({ page }) => {
    await login(page, { withContext: false });
    await expect(page.getByRole("heading", { name: "Choose an arena" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Join with an invitation" })).toBeVisible();
  });

  test("practice needs no node: the CPU fights back", async ({ page }) => {
    const errors = watchForErrors(page);
    await page.goto("/practice");
    const canvas = page.locator("canvas.arena-canvas");
    await expect(canvas).toBeVisible();
    await canvas.click();
    await page.waitForTimeout(2_000);
    for (const key of ["KeyD", "KeyD", "KeyJ", "KeyK", "KeyW", "KeyI"]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(200);
    }
    // The engine runs: the screen keeps changing frame to frame.
    const a = await canvas.screenshot();
    await page.waitForTimeout(300);
    const b = await canvas.screenshot();
    expect(a.equals(b)).toBe(false);
    errors.assertClean();
  });
});
