import { expect, test } from "@playwright/test";

// The app shell with no node attached — the state a cold CI run and a first
// visitor are both in. Nothing here needs a contract; what it defends is that
// the page mounts and stays usable when every read fails, rather than showing a
// blank screen or an uncaught error.
test.describe("app shell", () => {
  test("the feed renders its chrome without a node", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await page.goto("/");
    await expect(page.getByRole("tab", { name: "New" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Top" })).toBeVisible();
    await expect(page.getByLabel("Start a discussion")).toBeVisible();
    expect(errors, "an unhandled error escaped to the page").toEqual([]);
  });

  test("the composer expands and validates before it will submit", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Start a discussion").click();

    const post = page.getByRole("button", { name: "Post" });
    // Disabled until BOTH fields have content — the contract rejects an empty
    // title or body, and failing in the UI beats a round trip to find out.
    await expect(post).toBeDisabled();
    await page.getByLabel("Title", { exact: true }).fill("Hello");
    await expect(post).toBeDisabled();
    await page.getByLabel("Text", { exact: true }).fill("World");
    await expect(post).toBeEnabled();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("Start a discussion")).toBeVisible();
  });

  test("an unknown route falls back to the feed", async ({ page }) => {
    await page.goto("/does-not-exist");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("tab", { name: "New" })).toBeVisible();
  });

  test("a post permalink renders the shell rather than a blank page", async ({ page }) => {
    await page.goto("/p/deadbeef");
    await expect(page.getByRole("link", { name: /back to the feed/i })).toBeVisible();
  });
});
