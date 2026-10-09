import { expect, test, type Page } from "@playwright/test";
import { MeroJs } from "@calimero-network/mero-js";

import { readState } from "./global-setup";

/**
 * Your side of the loop, through the UI, against a real node:
 *
 *   connect → create your feed → an app's notification lands in it (recorded
 *   through the contract, as the collector or mero-bot records one) → you
 *   answer it in place → the contract holds your answer for the agent.
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

  expect(errors, "an unhandled error escaped to the page").toEqual([]);
});
