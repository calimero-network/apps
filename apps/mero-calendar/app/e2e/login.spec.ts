import { test, expect } from "@playwright/test";

// Unauthenticated, the /login route shows the mero-react ConnectButton inside
// our connect card. No node is reachable, so MeroProvider resolves to
// "not authenticated" and the card renders.
test.describe("Login page", () => {
  test("shows the connect card when unauthenticated", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByTestId("login-connect")).toBeVisible({ timeout: 10_000 });
  });
});
