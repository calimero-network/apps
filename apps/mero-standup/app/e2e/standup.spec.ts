/**
 * Every control a user touches, driven against a real merod.
 *
 * The contract's own tests cover the rules and the merobox scenarios cover
 * two-node convergence and the v1 -> v2 upgrade. Neither shows that a button
 * calls the method it names, that the result reaches the screen, or that the
 * screen agrees with the contract afterwards. One node, so these specs are one
 * person; help on a teammate's blocker lives in logic/workflows/e2e.yml.
 *
 * Serial and in this order: they share one team, and the carry-forward spec
 * relies on today being empty after the post/withdraw spec.
 */
import { expect, test, type Page } from "@playwright/test";
import { btn, field, login, unique, waitForTeam, watchForErrors } from "./helpers";

test.describe.configure({ mode: "serial" });

/** One log entry, by its OWN title — a replacement's "Replaces “…”" names the
 *  original too, so matching on text alone finds both. */
const decision = (page: Page, title: string) =>
  page.getByTestId("decisions").locator("li.decision", {
    has: page.locator(".decision-title", { hasText: title }),
  });

test.describe("mero-standup", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await waitForTeam(page);
  });

  test("first run asks for a name, and it becomes the byline", async ({ page }) => {
    const watch = watchForErrors(page);
    const name = unique("Ana");
    await expect(page.getByRole("heading", { name: "Welcome to the team" })).toBeVisible({
      timeout: 20_000,
    });
    await page.getByLabel("your name").fill(name);
    await btn(page, "Continue").click();
    await expect(page.getByTestId("my-name")).toHaveText(name, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Welcome to the team" })).toHaveCount(0);

    // It is in the contract, not just the page.
    await page.reload();
    await expect(page.getByTestId("my-name")).toHaveText(name, { timeout: 30_000 });
    watch.assertClean();
  });

  test("name the team from the top bar", async ({ page }) => {
    const name = unique("Platform");
    await page.getByTestId("team-name").click();
    await page.getByLabel("team name").fill(name);
    await btn(page, "Save").click();
    await expect(page.getByTestId("team-name")).toContainText(name, { timeout: 20_000 });
  });

  test("post with Ctrl+Enter, edit in a blocker, see it surface, withdraw", async ({ page }) => {
    const watch = watchForErrors(page);
    await expect(page.getByTestId("day-title")).toContainText("Today");

    const done = unique("Shipped");
    await field(page, "done").fill(`${done}\n- with a bullet`);
    await field(page, "next").fill("Write the release notes");
    await field(page, "next").press("Control+Enter");

    const mine = page.getByTestId("my-update");
    await expect(mine).toContainText(done, { timeout: 20_000 });
    // Bullet lines render as a list, not as a literal "- ".
    await expect(mine.locator("li", { hasText: "with a bullet" })).toBeVisible();

    const blocker = unique("Waiting on review");
    await btn(page, "Edit").click();
    await field(page, "blockers").fill(blocker);
    await btn(page, "Save update").click();
    await expect(mine).toContainText(blocker, { timeout: 20_000 });
    await expect(page.getByTestId("blockers")).toContainText(blocker, { timeout: 20_000 });

    await btn(page, "Withdraw").click();
    await expect(btn(page, "Post update")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("blockers")).not.toContainText(blocker, { timeout: 20_000 });
    watch.assertClean();
  });

  test("yesterday's next becomes today's draft", async ({ page }) => {
    const watch = watchForErrors(page);
    const plan = unique("Build the parser");
    await page.getByRole("button", { name: "previous day" }).click();
    await expect(page.getByTestId("day-title")).toContainText("Yesterday");
    await field(page, "done").fill("Wrote the spec");
    await field(page, "next").fill(plan);
    await field(page, "blockers").fill("Need the API key");
    await btn(page, "Post update").click();
    await expect(page.getByTestId("my-update")).toContainText(plan, { timeout: 20_000 });

    await page.getByRole("button", { name: "next day" }).click();
    await expect(page.getByTestId("day-title")).toContainText("Today");
    await expect(page.getByTestId("carried")).toBeVisible({ timeout: 20_000 });
    await expect(field(page, "done")).toHaveValue(plan);
    await expect(field(page, "next")).toHaveValue("");
    await expect(field(page, "blockers")).toHaveValue("Need the API key");
    watch.assertClean();
  });

  test("the week strip and the week digest", async ({ page }) => {
    // Yesterday's post is on the strip and in the digest of yesterday's week.
    await page.getByRole("button", { name: "previous day" }).click();
    await expect(page.getByTestId("day-title")).toContainText("Yesterday");
    await expect(page.getByRole("button", { name: /^Yesterday, 1 update$/ })).toBeVisible();

    await page.getByRole("tab", { name: "Week" }).click();
    await expect(page.getByTestId("week-title")).toBeVisible();
    const digest = page.getByTestId("digest");
    // Yesterday may fall in last week on a Monday.
    if (!(await digest.getByText("Wrote the spec").isVisible())) {
      await page.getByRole("button", { name: "previous week" }).click();
    }
    await expect(digest).toContainText("Wrote the spec", { timeout: 20_000 });
  });

  test("log a tagged decision, supersede it, filter, and see the timeline", async ({ page }) => {
    const watch = watchForErrors(page);
    await page.getByRole("tab", { name: "Decisions" }).click();

    const first = unique("Release every two weeks");
    await page.getByRole("button", { name: /^\+ Log a decision$/ }).click();
    await page.getByLabel("decision title").fill(first);
    await page.getByLabel("decision", { exact: true }).fill("Every other Tuesday");
    await page.getByLabel("rationale").fill("Weekly was too much overhead");
    await page.getByLabel("tags").fill("Release Process, infra");
    await btn(page, "Log decision").click();

    const firstItem = decision(page, first);
    await expect(firstItem).toContainText("Standing", { timeout: 20_000 });
    await expect(firstItem).toContainText("#release-process");

    await firstItem.getByRole("button", { name: "Supersede…" }).click();
    await expect(page.getByRole("heading", { name: "Supersede a decision" })).toBeVisible();
    const second = unique("Release weekly");
    await page.getByLabel("decision title").fill(second);
    await page.getByLabel("decision", { exact: true }).fill("Every Tuesday");
    // A replacement starts with the original's tags; this one drops #infra.
    await expect(page.getByLabel("tags")).toHaveValue("infra, release-process");
    await page.getByLabel("tags").fill("release-process");
    await btn(page, "Log replacement").click();

    await expect(firstItem).toContainText("Superseded", { timeout: 20_000 });
    await expect(firstItem).toContainText(`Replaced by “${second}”`);
    const secondItem = decision(page, second);
    await expect(secondItem).toContainText(`Replaces “${first}”`);

    // The tag filter chip, then standing-only, then search.
    await page.getByRole("button", { name: /^#infra/ }).first().click();
    await expect(firstItem).toBeVisible();
    await expect(secondItem).toHaveCount(0, { timeout: 20_000 });
    await page.getByRole("button", { name: /^#infra/ }).first().click();
    await page.getByLabel("Standing only").check();
    await expect(firstItem).toHaveCount(0, { timeout: 20_000 });
    await expect(secondItem).toBeVisible();
    await page.getByLabel("Standing only").uncheck();
    await page.getByLabel("search decisions").fill("too much overhead");
    await expect(firstItem).toBeVisible({ timeout: 20_000 });
    await expect(secondItem).toHaveCount(0);

    await page.getByLabel("search decisions").fill("");
    await page.getByRole("radio", { name: "Timeline" }).click();
    await expect(page.getByTestId("timeline")).toContainText(second, { timeout: 20_000 });
    watch.assertClean();
  });

  test("the theme menu switches light and dark", async ({ page }) => {
    await page.getByRole("button", { name: "account menu" }).click();
    await page.getByRole("radio", { name: "Light" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("radio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("radio", { name: "System" }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-theme", /./);
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
