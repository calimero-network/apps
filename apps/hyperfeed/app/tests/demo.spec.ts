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
  await vote.locator(".row-line, .need-line").click();
  await vote.getByRole("button", { name: "Lisbon" }).click();
  // Answered, then the pretend agent reports it delivered: it moves to done.
  await expect(vote.locator(".note")).toContainText("Lisbon");
  await expect(page.getByRole("region", { name: "Done" })).toContainText(/vote: "Offsite location"/i, { timeout: 15_000 });

  expect(errors, "an unhandled error escaped to the page").toEqual([]);
});

test("in the demo, a chain expands into its whole flow", async ({ page }) => {
  await page.goto("/demo");
  await page.locator("li.row", { hasText: "Vendor NDA" }).locator(".row-line, .need-line").click();
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
  // The same chain, in the feed: in your agent's digest, as your question with its answer in the thread.
  await page.getByRole("link", { name: "Feed", exact: true }).click();
  const agent = page.getByRole("region", { name: "Your agent today" });
  await agent.getByRole("button", { name: /^Show/ }).click();
  const chat = agent.locator("li.row", { hasText: "What's left before the board meeting?" });
  await expect(chat).toContainText("Agent replied");
  await chat.locator(".row-line, .need-line").click();
  await expect(chat.getByRole("list", { name: "The whole flow" })).toContainText("pretend agent");
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

test("on a computer, a long chat scrolls inside its thread, and the page and the composer stay put", async ({ page }) => {
  const explain = watch(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/demo/chat");
  const box = page.getByLabel("Message your agent");
  const thread = page.getByRole("log");
  for (let i = 1; i <= 8; i++) {
    await box.fill(`Message ${i}: ${"a long line about the plan for this week, ".repeat(8)}`);
    await box.press("Enter");
    // Each one answered before the next: the pretend agent is one turn at a time.
    await explain(expect(thread.getByText(/pretend agent/)).toHaveCount(i, { timeout: 15_000 }));
  }
  const layout = await page.evaluate(() => {
    const t = document.querySelector(".chat-thread")!;
    const composer = document.querySelector(".chat-composer")!.getBoundingClientRect();
    return {
      pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
      threadScrolls: t.scrollHeight > t.clientHeight,
      composerOnScreen: composer.bottom <= window.innerHeight + 1,
    };
  });
  expect(layout).toEqual({ pageScrolls: false, threadScrolls: true, composerOnScreen: true });
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

for (const [device, size] of [
  ["a computer", { width: 1280, height: 800 }],
  ["a phone", { width: 360, height: 740 }],
] as const) {
  test(`on ${device}, you archive a chat after confirming, restore it from Archived chats, and Undo brings it back`, async ({ page }) => {
    const explain = watch(page);
    // The pretend agent takes your message up after 0.7 s and answers after
    // 2.8 s, and anything new brings an archived chat back: on a slow runner the
    // answer landed between Archive and Restore and took the chat off the shelf
    // mid-click. The page's clock is held, and moved on only far enough for the
    // agent to take the message up, so it is working on it and never answers.
    await page.clock.install();
    await page.setViewportSize(size);
    await page.goto("/demo/chat");
    await page.clock.pauseAt(Date.now() + 1_000);
    await page.getByRole("button", { name: "New chat" }).click();
    await page.getByLabel("Message your agent").fill("Throwaway question");
    await page.getByLabel("Message your agent").press("Enter");
    await expect(page.getByRole("log").getByText("Throwaway question", { exact: true })).toBeVisible();
    await page.clock.runFor(1_000);

    await page.getByRole("button", { name: "Archive chat" }).click();
    const ask =page.getByRole("group", { name: "Archive this chat?" });
    await expect(ask).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await ask.getByRole("button", { name: "Archive" }).click();

    const chats = page.getByRole("navigation", { name: "Chats" });
    await expect(page.getByRole("status").filter({ hasText: "Chat archived" })).toBeVisible();
    await expect(chats).toBeVisible();
    await explain(expect(chats.getByRole("button", { name: /Throwaway question/ })).toHaveCount(0));
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(chats.getByRole("button", { name: /Throwaway question/ })).toBeVisible();

    // Archived again, it waits under Archived chats, and Restore brings it back.
    await chats.getByRole("button", { name: /Throwaway question/ }).click();
    await page.getByRole("button", { name: "Archive chat" }).click();
    await page.getByRole("group", { name: "Archive this chat?" }).getByRole("button", { name: "Archive" }).click();
    await chats.getByRole("button", { name: /Show archived chats/ }).click();
    const shelf = chats.getByRole("list", { name: "Archived chats" });
    await shelf.getByRole("button", { name: "Restore" }).first().click();
    await expect(chats.getByRole("button", { name: /Throwaway question/ })).toHaveCount(1);
  });
}

test("in the demo, the feed is three lanes, light or dark, and done things archive away", async ({ page }) => {
  await page.goto("/demo");
  for (const lane of ["Needs you", "In progress", "Done"]) await expect(page.getByRole("region", { name: lane })).toBeVisible();
  await expect(page.getByText("Agent live")).toBeVisible();
  await page.getByRole("button", { name: /Use (dark|light) theme/ }).click();
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  expect(["light", "dark"]).toContain(theme);
  const done = page.getByRole("region", { name: "Done" });
  await done.getByRole("button", { name: "Archive all done" }).click();
  await expect(done.getByRole("button", { name: "Archive all done" })).toBeHidden();
  await page.getByRole("status").getByRole("button", { name: "Undo" }).click();
  // The demo's done chain is your agent's stand-up: back in its digest.
  const agent = page.getByRole("region", { name: "Your agent today" });
  await agent.getByRole("button", { name: /^Show/ }).click();
  await expect(agent.locator("li.row", { hasText: "Posted your stand-up" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});


test("Settings opens one section at a time, and an old Controls link lands on it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/demo/controls");
  await expect(page).toHaveURL(/\/demo\/settings\/controls$/);
  const sections = page.getByRole("navigation", { name: "Settings" });
  await expect(sections.getByRole("link", { name: /Controls/ })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("region", { name: "What your agent may do, app by app" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Connect your agent" })).toHaveCount(0);

  await sections.getByRole("link", { name: /Rules/ }).click();
  await expect(page).toHaveURL(/\/demo\/settings\/rules$/);
  await expect(page.getByRole("region", { name: "Language" })).toBeVisible();
  await expect(page.getByRole("region", { name: "General rules" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Rules for one agent" })).toBeVisible();
  await expect(page.getByRole("region", { name: "What your agent may do, app by app" })).toHaveCount(0);

  await sections.getByRole("link", { name: /Agents/ }).click();
  await expect(page).toHaveURL(/\/demo\/settings\/agents$/);
  await expect(page.getByRole("region", { name: "Your agents", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Connect your agent" })).toBeVisible();
  await expect(page.getByRole("region", { name: "What your agent may do, app by app" })).toHaveCount(0);

  await sections.getByRole("link", { name: /Lenses/ }).click();
  await expect(page.getByRole("region", { name: "What your feed reads from each app" })).toBeVisible();
  // The top bar names the page Settings, wherever in it you are.
  await expect(page.getByRole("navigation", { name: "Pages" }).getByRole("link", { name: "Settings" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  expect(errors, "an unhandled error escaped to the page").toEqual([]);
});
