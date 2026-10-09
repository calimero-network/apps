import { expect, test } from "@playwright/test";

/**
 * The node-less shell: the landing page and `/demo`, the same screens run
 * against `DemoBackend`. No merod; the node-backed suite is e2e/.
 */

test("the landing page offers to connect or to try the demo", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "One feed for your agent and your apps" })).toBeVisible();
  await page.getByRole("link", { name: "Try the demo" }).click();
  await expect(page).toHaveURL(/\/demo$/);
});

test("in the demo, a choice is answered in place and the agent delivers it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/demo");
  const vote = page.locator("article.card", { hasText: 'Vote: "Offsite location"' });
  await expect(vote).toBeVisible();
  await vote.getByRole("button", { name: "Lisbon" }).click();
  // Answered, then the pretend agent reports it delivered.
  await expect(vote.locator(".note")).toContainText("Lisbon");
  await expect(vote.getByText("Answered", { exact: true })).toBeVisible({ timeout: 15_000 });

  expect(errors, "an unhandled error escaped to the page").toEqual([]);
});

test("in the demo, a chain expands into its whole flow", async ({ page }) => {
  await page.goto("/demo");
  const flow = page.getByRole("button", { name: /Show the flow · \d+ steps/ }).first();
  await flow.click();
  await expect(page.getByRole("list", { name: "The whole flow" }).first()).toBeVisible();
});
