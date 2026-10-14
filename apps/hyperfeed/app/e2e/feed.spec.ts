import { expect, test, type Page } from "@playwright/test";
import { MeroJs } from "@calimero-network/mero-js";

import { readState } from "./global-setup";

/**
 * Your side of the loop, through the UI, against a real node:
 *
 *   connect → create your feed → an app's notification lands in it (recorded
 *   through the contract, as the collector or mero-bot records one) → you
 *   answer it in place → the contract holds your answer for the agent → you
 *   ask your agent about it → the agent (played here through the contract,
 *   as mero-bot calls it) takes it up and answers in the same chain.
 *
 * The agent's side (check, propose, carry out, complete) is covered on two
 * nodes by logic/workflows/feed.yml and against a node by mero-bot's
 * `npm run e2e:hyperfeed`.
 */

async function login(page: Page) {
  const s = readState();
  await page.addInitScript(
    ([key, url]) => window.localStorage.setItem(key, url),
    ["mero:node_url", s.nodeUrl] as const,
  );
  const params = new URLSearchParams({
    access_token: s.accessToken,
    refresh_token: s.refreshToken,
    node_url: s.nodeUrl,
    application_id: s.applicationId,
  });
  await page.goto(`/#${params.toString()}`);
}

/**
 * Sign in again and open a feed: the first test's, or, once the switcher test
 * has made a second, the first one the picker lists.
 */
async function openFeed(page: Page) {
  await login(page);
  await page.getByRole("button", { name: /^Open feed / }).first().click();
  await expect(page.getByRole("region", { name: "Needs you" })).toBeVisible({ timeout: 60_000 });
}

/** A feed's short id, the hint beside its name (src/feeds.ts `hint`). */
const hint = (id: string) => id.slice(0, 8);

/** A chain's row in the feed, opened in place as a click opens it. */
async function openRow(page: Page, text: string) {
  const row = page.locator("li.row", { hasText: text });
  await expect(row).toBeVisible();
  const line = row.locator(".row-line, .need-line");
  if ((await line.getAttribute("aria-expanded")) !== "true") await line.click();
  return row;
}

/** The node, as a script calls it: the identity the collector and mero-bot write as. */
function node(): MeroJs {
  const s = readState();
  const mero = new MeroJs({ baseUrl: s.nodeUrl });
  mero.setTokenData({
    access_token: s.accessToken,
    refresh_token: s.refreshToken,
    expires_at: Date.now() + 60 * 60_000,
  });
  return mero;
}

test("you create your feed and answer a notification in place", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await login(page);

  // ── your feed ──────────────────────────────────────────────────────────────
  const name = page.getByLabel("Feed name");
  await expect(name).toHaveValue("My feed");
  await name.fill("Inbox");
  await page.getByRole("button", { name: "Create my feed" }).click();
  await expect(page.getByRole("region", { name: "Needs you" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("You're clear. Nothing is waiting on you.")).toBeVisible();

  // ── an app's notification arrives ──────────────────────────────────────────
  const mero = node();
  const contexts = (await mero.admin.getContexts()).contexts;
  expect(contexts, "the feed is the node's only context").toHaveLength(1);
  const contextId = contexts[0]!.id;
  // The name is on the feed's context and its namespace, as admin tools show it.
  const group = await mero.admin.getContextGroup(contextId);
  expect(group).toBeTruthy();
  expect((await mero.admin.getContextMetadata(group!, contextId))?.name).toBe("Inbox");
  expect((await mero.admin.listNamespaces()).find((n) => n.namespaceId === group)?.name).toBe("Inbox");
  await expect(page.getByTitle("Switch feed")).toHaveText(`Inbox · ${hint(contextId)}`);
  const recorded = await mero.rpc.execute<{ id: string }>({
    contextId,
    method: "record_notification",
    argsJson: {
      input: {
        key: "chat-launch:e2e>1:0",
        app: "chat",
        source_context: "chat-ctx",
        source_label: "#launch",
        from: "Maya",
        title: "Mentioned you",
        body: "Can your agent pull the numbers?",
        event: "MessageSent",
        needs_you: true,
        chain: "",
        ask: { kind: "reply", prompt: "Reply in #launch", options: [], draft: "" },
      },
    },
  });

  // The feed's own event refreshes the page; no reload.
  const card = await openRow(page, "Mentioned you");
  // A card says it twice: once in its head (one line), once in full when opened.
  await expect(card.locator(".need-object")).toHaveText("Can your agent pull the numbers?");
  await expect(card.locator("p.quote")).toHaveText("Can your agent pull the numbers?");
  // The card says who wants what as a sentence, from the title.
  await expect(page.getByRole("region", { name: "Needs you" })).toContainText("Maya mentioned you");

  // ── you answer it where it is ──────────────────────────────────────────────
  await card.getByLabel("Reply in #launch").fill("Numbers are in the deck.");
  await card.getByRole("button", { name: "Send" }).first().click();
  await expect(card.getByText('You replied: "Numbers are in the deck."')).toBeVisible();
  await expect(card.getByText("Answered · agent sending")).toBeVisible();

  // ── the contract holds it for your agent ───────────────────────────────────
  const item = await mero.rpc.execute<{ status: string; note: string; history: { status: string }[] } | null>({
    contextId,
    method: "item",
    argsJson: { id: recorded.id },
  });
  expect(item?.status).toBe("answered");
  expect(item?.note).toBe("Numbers are in the deck.");
  expect(item?.history.map((s) => s.status)).toEqual(["received", "answered"]);

  // ── you talk to your agent about it ────────────────────────────────────────
  await card.getByLabel("Talk to your agent about this").fill("Who else asked for the numbers?");
  await card.getByRole("button", { name: "Send" }).last().click();
  // One row per chain: your question now leads Maya's, a conversation with your agent, in its digest.
  const talk = page.locator("li.row", { hasText: "Who else asked for the numbers?" });
  await expect(page.getByRole("region", { name: "Your agent today" })).toContainText("Who else asked for the numbers?");
  await expect(talk.getByText("Sent · waiting for your agent")).toBeVisible();

  // ── your agent picks it up and answers, in the same chain ──────────────────
  const open = await mero.rpc.execute<{ id: string; chain: string }[]>({ contextId, method: "open_questions", argsJson: {} });
  expect(open).toHaveLength(1);
  const question = open[0]!;
  expect(question.chain, "the question joined Maya's chain").toBe(await chainOf(mero, contextId, recorded.id));
  await mero.rpc.execute({ contextId, method: "agent_ack", argsJson: { id: question.id, status: "thinking", note: "" } });
  await expect(talk.getByText("Your agent is on it")).toBeVisible();
  await mero.rpc.execute({
    contextId,
    method: "agent_say",
    argsJson: { chain: question.chain, reply_to: question.id, text: "Only Maya, in #launch." },
  });
  const answer = page.locator("li.row", { hasText: "Only Maya, in #launch." });
  await expect(answer).toBeVisible();
  await expect(answer.getByText("Your agent", { exact: true }).first()).toBeVisible();
  const asked = await mero.rpc.execute<{ status: string } | null>({ contextId, method: "item", argsJson: { id: question.id } });
  expect(asked?.status).toBe("answered");

  // ── your agent sends your reply to Maya, and the chain settles ─────────────
  // Until it does, your answer is still being carried and the chain stays in
  // progress; the archive test below needs it settled, in Done.
  await mero.rpc.execute({
    contextId,
    method: "complete_answer",
    argsJson: { id: recorded.id, outcome: "delivered", note: "Sent in #launch" },
  });
  await expect
    .poll(async () => {
      const rows = await mero.rpc.execute<{ items: { chain: string; kind: string; status: string }[] }>({
        contextId,
        method: "feed",
        argsJson: { filter: "all", app_key: "", limit: 50, before: 0 },
      });
      const lead = rows.items.find((r) => r.chain === question.chain);
      return lead && `${lead.kind}:${lead.status}`;
    })
    .not.toBe("notification:answered");
  expect((await mero.rpc.execute<{ status: string } | null>({ contextId, method: "item", argsJson: { id: recorded.id } }))?.status).toBe(
    "delivered",
  );

  expect(errors, "an unhandled error escaped to the page").toEqual([]);
});

async function chainOf(mero: MeroJs, contextId: string, id: string): Promise<string> {
  const row = await mero.rpc.execute<{ chain: string } | null>({ contextId, method: "item", argsJson: { id } });
  return row?.chain ?? "";
}

test("a typed row is answered straight into its app, and a refusal comes back to you", async ({ page }) => {
  await openFeed(page);
  const mero = node();
  const contextId = (await mero.admin.getContexts()).contexts[0]!.id;
  // A message a lens typed, whose reply call names a context this node does not
  // have: the feed makes the call itself, and the node's refusal is the answer.
  await mero.rpc.execute({
    contextId,
    method: "record_notification",
    argsJson: {
      input: {
        key: "chat-typed:e2e>2:0",
        app: "chat",
        source_context: "0".repeat(64),
        source_label: "#launch",
        from: "Maya Ortiz",
        title: "Sent you a message",
        body: "are you free at 3?",
        event: "MessageSent",
        needs_you: true,
        chain: "",
        ask: { kind: "reply", prompt: "Reply to Maya", options: [], draft: "" },
        item_type: "message",
        fields: JSON.stringify({ from: "Maya Ortiz", text: "are you free at 3?", where: "DM", is_dm: true }),
        reply_call: JSON.stringify({ method: "send_message", args: { message: "=answer" } }),
      },
    },
  });
  const card = await openRow(page, "Sent you a message");
  await expect(card.getByText("Message", { exact: true })).toBeVisible();
  await card.getByLabel("Reply to Maya").fill("Yes, 3 works");
  await card.getByRole("button", { name: "Send" }).first().click();
  await expect(card.getByText("Not sent · needs you").first()).toBeVisible();
  // The row goes back to you, and can be answered again.
  await expect(card.getByLabel("Reply to Maya")).toBeVisible();
});

test("you approve a lens your agent proposed, in Settings → Lenses", async ({ page }) => {
  await openFeed(page);
  const mero = node();
  const contextId = (await mero.admin.getContexts()).contexts[0]!.id;
  const spec = { version: 1, events: { Inserted: { type: "status", fields: { what: "=event.key" } }, Removed: "ignore" } };
  await mero.rpc.execute({
    contextId,
    method: "propose_lens",
    argsJson: { app_key: "kv-store", application_id: "kv-app-1", spec: JSON.stringify(spec), summary: "Keys set in kv-store" },
  });
  await page.getByRole("link", { name: "Settings" }).click();
  // Waiting for you: Lenses counts it.
  await page.getByRole("navigation", { name: "Settings" }).getByRole("link", { name: /Lenses/ }).click();
  await expect(page).toHaveURL(/\/settings\/lenses$/);
  const lens = page.locator("li.lens", { hasText: "Keys set in kv-store" });
  await expect(lens.getByText("Waiting for you")).toBeVisible();
  await expect(lens).toContainText("Inserted → Status · 1 other event ignored");
  await lens.getByRole("button", { name: "Approve" }).click();
  await expect(lens.getByText("In use")).toBeVisible();
  const [stored] = await mero.rpc.execute<{ status: string }[]>({ contextId, method: "lenses", argsJson: {} });
  expect(stored?.status).toBe("approved");
});

test("you start a chat with your agent and it answers there", async ({ page }) => {
  await openFeed(page);
  const mero = node();
  const contextId = (await mero.admin.getContexts()).contexts[0]!.id;

  await page.getByRole("link", { name: "Chat" }).click();
  await page.getByRole("button", { name: "New chat" }).click();
  await page.getByLabel("Message your agent").fill("testing this");
  await page.getByLabel("Message your agent").press("Enter");
  const thread = page.getByRole("log");
  await expect(thread.getByText("testing this")).toBeVisible();
  await expect(thread.getByText("Sent · waiting for your agent")).toBeVisible();
  await expect(page.getByLabel("Message your agent")).toHaveValue("");

  // Your agent, played through the contract as mero-bot calls it.
  const open = await mero.rpc.execute<{ id: string; chain: string; body: string }[]>({ contextId, method: "open_questions", argsJson: {} });
  const asked = open.find((q) => q.body === "testing this")!;
  expect(page.url()).toContain(`/chat/${asked.chain}`);
  await mero.rpc.execute({ contextId, method: "agent_ack", argsJson: { id: asked.id, status: "thinking", note: "" } });
  await expect(thread.getByText("Your agent is on it…")).toBeVisible();
  await mero.rpc.execute({ contextId, method: "agent_say", argsJson: { chain: asked.chain, reply_to: asked.id, text: "Loud and clear." } });
  await expect(thread.getByText("Loud and clear.")).toBeVisible();

  // A follow-up stays in the same chat.
  await page.getByLabel("Message your agent").fill("Great, thanks");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(thread.getByText("Great, thanks")).toBeVisible();
  const chain = await mero.rpc.execute<unknown[]>({ contextId, method: "chain", argsJson: { chain: asked.chain } });
  expect(chain).toHaveLength(3);
  await expect(page.getByRole("navigation", { name: "Chats" }).getByRole("button", { name: /Great, thanks/ })).toBeVisible();
});

test("you see when your agent is there, and archive what is done", async ({ page }) => {
  await openFeed(page);
  const mero = node();
  const contextId = (await mero.admin.getContexts()).contexts[0]!.id;
  await expect(page.getByText("No agent connected")).toBeVisible();
  // mero-bot reports in every half minute; one report is enough to show it.
  await mero.rpc.execute({ contextId, method: "agent_seen", argsJson: { name: "mero-bot@e2e" } });
  await expect(page.getByText("Agent live")).toBeVisible({ timeout: 25_000 });

  // What is done here is your agent's: in its digest, and archived with the rest.
  const done = page.getByRole("region", { name: "Done" });
  await done.getByRole("button", { name: "Archive all done" }).click();
  await expect(done.getByText("Nothing finished yet.")).toBeVisible();
  // The lane can read empty before the archive lands (your agent's rows are
  // in its digest), so wait for the node rather than read it once.
  await expect
    .poll(async () => {
      const page1 = await mero.rpc.execute<{ counts: { archived: number } }>({
        contextId,
        method: "feed",
        argsJson: { filter: "all", app_key: "", limit: 50, before: 0 },
      });
      return page1.counts.archived;
    })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: /^Archived · \d+/ }).click();
  await expect(page.getByRole("region", { name: "Archived" }).locator("li.row").first()).toBeVisible();
});

// Last: it leaves a second feed on the node, and the tests above open "the" feed.
test("you switch between your feeds without signing in again", async ({ page }) => {
  await openFeed(page);
  const first = (await node().admin.getContexts()).contexts[0]!.id;
  const switcher = page.getByTitle("Switch feed");
  await expect(switcher).toHaveText(`Inbox · ${hint(first)}`);
  await expect(page.getByRole("button", { name: /^Archived · \d+/ })).toBeVisible();

  // A second feed, named as it is made from the switcher, opens in place.
  await switcher.click();
  await page.getByRole("menuitem", { name: "Create a new feed" }).click();
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("My feed");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(switcher).not.toHaveText(`Inbox · ${hint(first)}`, { timeout: 60_000 });
  await expect(page.getByText("You're clear. Nothing is waiting on you.")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Archived · \d+/ })).toHaveCount(0);
  const second = (await node().admin.getContexts()).contexts.map((c) => c.id).find((id) => id !== first)!;
  await expect(switcher).toHaveText(`My feed · ${hint(second)}`);

  // Renamed from the switcher: on its context too.
  await switcher.click();
  await page.getByRole("menuitem", { name: `Rename feed My feed · ${hint(second)}` }).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Side project");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(switcher).toHaveText(`Side project · ${hint(second)}`, { timeout: 30_000 });
  const group = await node().admin.getContextGroup(second);
  expect((await node().admin.getContextMetadata(group!, second))?.name).toBe("Side project");
  await switcher.click();

  // Back to the first: the same session, its rows again.
  await switcher.click();
  const items = page.getByRole("menuitemradio");
  await expect(items).toHaveCount(2);
  await items.filter({ hasText: hint(first) }).click();
  await expect(switcher).toHaveText(`Inbox · ${hint(first)}`);
  await expect(page.getByRole("button", { name: /^Archived · \d+/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  // The feed you switched to is the one a reload opens.
  await page.reload();
  await expect(page.getByTitle("Switch feed")).toHaveText(`Inbox · ${hint(first)}`, { timeout: 60_000 });
});

test("you delete a feed you no longer use, with its namespace", async ({ page }) => {
  await openFeed(page);
  const before = (await node().admin.getContexts()).contexts.map((c) => c.id);
  expect(before.length).toBeGreaterThanOrEqual(2);
  // Names are read after the feed opens: wait for "Name · id" before reading it.
  await expect(page.getByTitle("Switch feed")).toContainText(" · ");
  const open = await page.getByTitle("Switch feed").textContent();
  const other = before.find((id) => !open?.endsWith(hint(id)))!;
  const group = await node().admin.getContextGroup(other);

  const switcher = page.getByTitle("Switch feed");
  await switcher.click();
  // The open feed has no Delete; the other one does, and says what it holds.
  await expect(page.getByRole("menuitem", { name: `Delete feed ${open}` })).toHaveCount(0);
  await expect(page.getByRole("menuitemradio").filter({ hasText: hint(other) })).toContainText(/Empty|\d+ rows?/);
  await page.getByRole("menuitem", { name: new RegExp(`^Delete feed .* · ${hint(other)}$`) }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("This can't be undone.");
  await confirm.getByRole("button", { name: "Delete" }).click();

  await expect(page.getByRole("menuitemradio")).toHaveCount(before.length - 1, { timeout: 30_000 });
  // The node can still list it for a moment after the switcher drops it.
  await expect.poll(async () => (await node().admin.getContexts()).contexts.map((c) => c.id)).not.toContain(other);
  if (group) {
    await expect.poll(async () => JSON.stringify(await node().admin.listNamespaces())).not.toContain(group);
  }
  // Still in the feed you had open.
  await expect(switcher).toHaveText(open!);
});
