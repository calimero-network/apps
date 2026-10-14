/**
 * Every control a user touches, driven against a real merod.
 *
 * The contract's own tests cover the rules and the merobox scenario covers
 * two-node convergence. Neither shows that a button calls the method it names,
 * that the result reaches the screen, or that the screen agrees with the
 * contract afterwards. One node, so these specs are one person; the second
 * person lives in logic/workflows/e2e.yml.
 */
import { expect, test, type Page } from "@playwright/test";
import { btn, field, login, unique, waitForTeam, watchForErrors } from "./helpers";

test.describe.configure({ mode: "serial" });

/** One log entry, by its OWN title — a replacement's "Replaces “…”" names the
 *  original too, so matching on text alone finds both. */
const decision = (page: Page, title: string) =>
  page.getByTestId("decisions").locator("li", {
    has: page.locator(".decision-title", { hasText: title }),
  });

test.describe("mero-standup", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await waitForTeam(page);
  });

  test("set a display name and see it as the byline", async ({ page }) => {
    const watch = watchForErrors(page);
    const name = unique("Ana");
    await page.getByRole("button", { name: /Set your name|Rename/ }).click();
    await page.getByLabel("your name").fill(name);
    await btn(page, "Save").click();
    await expect(page.getByTestId("my-name")).toHaveText(name, { timeout: 20_000 });

    // It is in the contract, not just the page: a reload reads it back.
    await page.reload();
    await expect(page.getByTestId("my-name")).toHaveText(name, { timeout: 30_000 });
    watch.assertClean();
  });

  test("post today's update, edit it, and see the blocker surface", async ({ page }) => {
    const watch = watchForErrors(page);
    await expect(page.getByTestId("day-title")).toContainText("Today");

    const done = unique("Shipped");
    await field(page, "done").fill(done);
    await field(page, "next").fill("Write the release notes");
    await btn(page, "Post update").click();

    const mine = page.getByTestId("my-update");
    await expect(mine).toContainText(done, { timeout: 20_000 });

    // Edit: add a blocker. It shows on the update and in "Blocked right now".
    const blocker = unique("Waiting on review");
    await btn(page, "Edit").click();
    await field(page, "blockers").fill(blocker);
    await btn(page, "Save update").click();
    await expect(mine).toContainText(blocker, { timeout: 20_000 });
    await expect(page.getByTestId("blockers")).toContainText(blocker, { timeout: 20_000 });

    // Withdraw it and the form is back, and the blocker is gone.
    await btn(page, "Withdraw").click();
    await expect(btn(page, "Post update")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("blockers")).not.toContainText(blocker, { timeout: 20_000 });
    watch.assertClean();
  });

  test("navigate to yesterday and back", async ({ page }) => {
    await page.getByRole("button", { name: "previous day" }).click();
    await expect(page.getByTestId("day-title")).toContainText("Yesterday");
    await expect(page.getByRole("button", { name: "next day" })).toBeEnabled();
    await btn(page, "Today").click();
    await expect(page.getByTestId("day-title")).toContainText("Today");
    await expect(page.getByRole("button", { name: "next day" })).toBeDisabled();
  });

  test("log a decision, supersede it, and filter the log", async ({ page }) => {
    const watch = watchForErrors(page);
    await page.getByRole("tab", { name: "Decisions" }).click();

    const first = unique("Release every two weeks");
    await page.getByLabel("decision title").fill(first);
    await page.getByLabel("decision", { exact: true }).fill("Every other Tuesday");
    await page.getByLabel("rationale").fill("Weekly was too much overhead");
    await btn(page, "Log decision").click();

    const firstItem = decision(page, first);
    await expect(firstItem).toContainText("Standing", { timeout: 20_000 });

    // Supersede it: the original stays, marked, and links to its replacement.
    await firstItem.getByRole("button", { name: "Supersede…" }).click();
    await expect(page.getByRole("heading", { name: "Supersede a decision" })).toBeVisible();
    const second = unique("Release weekly");
    await page.getByLabel("decision title").fill(second);
    await page.getByLabel("decision", { exact: true }).fill("Every Tuesday");
    await btn(page, "Log replacement").click();

    await expect(firstItem).toContainText("Superseded", { timeout: 20_000 });
    await expect(firstItem).toContainText(`Replaced by “${second}”`);
    const secondItem = decision(page, second);
    await expect(secondItem).toContainText(`Replaces “${first}”`);

    // Standing only hides the replaced one; search finds by rationale.
    await page.getByLabel("Standing only").check();
    await expect(firstItem).toHaveCount(0, { timeout: 20_000 });
    await expect(secondItem).toBeVisible();
    await page.getByLabel("Standing only").uncheck();
    await page.getByLabel("search decisions").fill("too much overhead");
    await expect(firstItem).toBeVisible({ timeout: 20_000 });
    await expect(secondItem).toHaveCount(0);
    watch.assertClean();
  });

  test("the invite tab mints a link for this team", async ({ page }) => {
    await page.getByRole("tab", { name: "Invite" }).click();
    await btn(page, "Create invite link").click();
    await expect(page.locator(".invite-link")).toContainText(
      "com.calimero.mero-standup/join?invitation=",
      { timeout: 20_000 },
    );
  });
});
