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

/** Sign in again and open the feed the first test created. */
async function openFeed(page: Page) {
  await login(page);
  await page.getByRole("button", { name: /^Open feed / }).click();
  await expect(page.getByRole("navigation", { name: "Feed filters" })).toBeVisible({ timeout: 60_000 });
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
  await page.getByRole("button", { name: "Create my feed" }).click();
  await expect(page.getByRole("navigation", { name: "Feed filters" })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Nothing here. Your agent and your apps are quiet.")).toBeVisible();

  // ── an app's notification arrives ──────────────────────────────────────────
  const mero = node();
  const contexts = (await mero.admin.getContexts()).contexts;
  expect(contexts, "the feed is the node's only context").toHaveLength(1);
  const contextId = contexts[0]!.id;
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
  const card = page.locator("article.card", { hasText: "Mentioned you" });
  await expect(card).toBeVisible();
  await expect(card.getByText("Can your agent pull the numbers?")).toBeVisible();
  await expect(page.getByRole("button", { name: /Needs you\s*1/ })).toBeVisible();

  // ── you answer it where it is ──────────────────────────────────────────────
  await card.getByRole("textbox").fill("Numbers are in the deck.");
  await card.getByRole("button", { name: "Send" }).click();
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
  await card.getByRole("button", { name: "Details" }).click();
  const detail = page.getByRole("complementary", { name: "Selected item" });
  await detail.getByLabel("Talk to your agent about this").fill("Who else asked for the numbers?");
  await detail.getByRole("button", { name: "Send" }).click();
  // One row per chain: your question now leads Maya's.
  const talk = page.locator("article.card", { hasText: "Who else asked for the numbers?" });
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
  const answer = page.locator("article.card", { hasText: "Only Maya, in #launch." });
  await expect(answer).toBeVisible();
  await expect(answer.getByText("Your agent", { exact: true }).first()).toBeVisible();
  const asked = await mero.rpc.execute<{ status: string } | null>({ contextId, method: "item", argsJson: { id: question.id } });
  expect(asked?.status).toBe("answered");

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
  const card = page.locator("article.card", { hasText: "are you free at 3?" });
  await expect(card.getByText("Message", { exact: true })).toBeVisible();
  await card.getByRole("textbox").fill("Yes, 3 works");
  await card.getByRole("button", { name: "Send" }).click();
  await expect(card.getByText("Not sent · needs you")).toBeVisible();
  // The row goes back to you, and can be answered again.
  await expect(card.getByRole("textbox")).toBeVisible();
});

test("you approve a lens your agent proposed, in Controls", async ({ page }) => {
  await openFeed(page);
  const mero = node();
  const contextId = (await mero.admin.getContexts()).contexts[0]!.id;
  const spec = { version: 1, events: { Inserted: { type: "status", fields: { what: "=event.key" } }, Removed: "ignore" } };
  await mero.rpc.execute({
    contextId,
    method: "propose_lens",
    argsJson: { app_key: "kv-store", application_id: "kv-app-1", spec: JSON.stringify(spec), summary: "Keys set in kv-store" },
  });
  await page.getByRole("link", { name: "Controls" }).click();
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
