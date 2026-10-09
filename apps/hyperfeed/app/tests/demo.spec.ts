import { expect, test, type Page } from "@playwright/test";

/**
 * Collects what the page threw, and puts it, with the chat as it stands, on
 * a failed wait: a chat that stops updating says why.
 */
function watch(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  return async (wait: Promise<unknown>) => {
    try {
      await wait;
    } catch (e) {
      const chat = await page.locator(".chat").evaluate((el) => el.outerHTML.slice(0, 3000)).catch(() => "(no .chat)");
      throw new Error(`${e instanceof Error ? e.message : String(e)}\nurl: ${page.url()}\npage errors:\n${errors.join("\n") || "(none)"}\nchat:\n${chat}`);
    }
  };
}

/**
 * The node-less shell: `/demo`, the same screens run against `DemoBackend`.
 * No merod; the node-backed suite is e2e/. The landing page has its own
 * generated spec beside this one (marketing-landing.spec.ts).
 */

test("in the demo, a choice is answered in place and the agent delivers it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/demo");
  const vote = page.locator("li.row", { hasText: 'Vote: "Offsite location"' });
  await vote.locator(".row-line").click();
  await vote.getByRole("button", { name: "Lisbon" }).click();
  // Answered, then the pretend agent reports it delivered: it moves to done.
  await expect(vote.locator(".note")).toContainText("Lisbon");
  await expect(page.getByRole("region", { name: "Done" })).toContainText('Vote: "Offsite location"', { timeout: 15_000 });

  expect(errors, "an unhandled error escaped to the page").toEqual([]);
});

test("in the demo, a chain expands into its whole flow", async ({ page }) => {
  await page.goto("/demo");
  await page.locator("li.row", { hasText: "Vendor NDA" }).locator(".row-line").click();
  await expect(page.getByRole("list", { name: "The whole flow" }).first()).toBeVisible();
});

test("in the demo, you ask your agent and the pretend agent answers in the same chain", async ({ page }) => {
  const explain = watch(page);
  await page.goto("/demo");
  const stream = page.getByRole("main");
  await stream.getByLabel("Ask your agent").fill("What's left before the board meeting?");
  await stream.getByRole("button", { name: "Send", exact: true }).first().click();
  // It opens as a chat: your question, then the pretend agent's answer.
  await expect(page).toHaveURL(/\/demo\/chat\//);
  const thread = page.getByRole("log");
  await expect(thread).toContainText("What's left before the board meeting?");
  await explain(expect(thread.getByText(/pretend agent/)).toBeVisible({ timeout: 15_000 }));
  // The same chain, in the feed.
  await page.getByRole("link", { name: "Feed", exact: true }).click();
  const answer = page.locator("li.row", { hasText: "pretend agent" });
  await answer.locator(".row-line").click();
  await expect(answer.getByRole("list", { name: "The whole flow" })).toContainText("What's left before the board meeting?");
});

test("in the demo, the chat page holds your chats with your agent", async ({ page }) => {
  const explain = watch(page);
  await page.goto("/demo/chat");
  await page.getByLabel("Message your agent").fill("Plan my week");
  await page.getByLabel("Message your agent").press("Enter");
  const thread = page.getByRole("log");
  await explain(expect(thread.getByText(/pretend agent/)).toBeVisible({ timeout: 15_000 }));
  await expect(page.getByRole("navigation", { name: "Chats" }).getByRole("button", { name: /pretend agent/ })).toBeVisible();
});

test("on a phone, the chat list and the open chat take turns", async ({ page }) => {
  const explain = watch(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/demo/chat");
  await page.getByRole("button", { name: "New chat" }).click();
  await page.getByLabel("Message your agent").fill("Hi");
  await page.getByLabel("Message your agent").press("Enter");
  await expect(page.getByRole("log").getByText("Hi", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Chats" })).toBeHidden();
  await page.getByRole("button", { name: "← Chats" }).click();
  await explain(expect(page.getByRole("navigation", { name: "Chats" })).toBeVisible());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("in the demo, the feed is three lanes, light or dark, and done things archive away", async ({ page }) => {
  await page.goto("/demo");
  for (const lane of ["To do", "In progress", "Done"]) await expect(page.getByRole("region", { name: lane })).toBeVisible();
  await expect(page.getByText("Agent live")).toBeVisible();
  await page.getByRole("button", { name: /Use (dark|light) theme/ }).click();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(["light", "dark"]).toContain(theme);
  const done = page.getByRole("region", { name: "Done" });
  await done.getByRole("button", { name: "Archive all done" }).click();
  await expect(done.getByText("Nothing finished yet.")).toBeVisible();
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  await expect(done.locator("li.row").first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

