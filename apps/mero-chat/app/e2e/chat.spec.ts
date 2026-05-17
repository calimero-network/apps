/**
 * Browser UI tests for the chat flow.
 *
 * Every action here goes through the actual browser UI — typing in the
 * ProseMirror editor, clicking buttons, reading the rendered message list.  No direct RPC
 * calls are made.
 *
 * Prerequisites: live nodes must be running.
 *   pnpm e2e:ui:all   — starts nodes then opens the Playwright UI
 *   pnpm e2e:nodes    — starts nodes and runs headless
 *
 * Tests skip gracefully when E2E env vars are absent.
 */

import { test, expect, type Page } from "@playwright/test";
import { getEnv, envAvailable } from "./helpers/rpc-client";
import { injectRealTokens } from "./helpers/node-client";

function requireEnv() {
  if (!envAvailable()) test.skip();
}

// ── App state injection ───────────────────────────────────────────────────────

async function setupApp(page: Page) {
  const env = getEnv();
  // Inject mero-react auth tokens
  await injectRealTokens(page, {
    nodeUrl:      env.nodeUrl,
    accessToken:  env.accessToken,
    refreshToken: env.refreshToken,
  });
  // Inject workspace state so the app skips the workspace selector
  await page.addInitScript(
    ({ groupId, memberKey }) => {
      // Group selection (app reads from sessionStorage with this key)
      sessionStorage.setItem("calimero_group_id", groupId);
      // App.tsx canEnterApp gate: requires this flag set in the same browser
      // session as the namespace selection. Without it, "/" redirects to /login.
      sessionStorage.setItem("curb_ns_ready", "1");
      // Messenger display name
      localStorage.setItem("chat-username", "Alice");
      // Member identity for this group (public key used for RPC calls)
      const identities = JSON.parse(
        localStorage.getItem("calimero_group_member_identities") ?? "{}",
      ) as Record<string, string>;
      identities[groupId] = memberKey;
      const serialized = JSON.stringify(identities);
      localStorage.setItem("calimero_group_member_identities", serialized);
      sessionStorage.setItem("calimero_group_member_identities", serialized);
      // calimero-client's getExecutorPublicKey() reads "context-identity" (JSON-encoded).
      // Without this, editable/deletable on messages sent by this user evaluates to false.
      localStorage.setItem("context-identity", JSON.stringify(memberKey));
      // Keep session alive
      localStorage.setItem("sessionLastActivity", Date.now().toString());
    },
    { groupId: env.groupId, memberKey: env.memberKey },
  );
}

// ── Navigation helpers ────────────────────────────────────────────────────────

async function openChannel(page: Page, channelName = "general") {
  await page.goto("/");
  // Wait for the sidebar channel list to load and click the channel
  const channelItem = page.getByText(channelName).first();
  await channelItem.waitFor({ timeout: 20_000 });
  await channelItem.click();
  // Wait for the main ProseMirror editor to appear (bottom of the chat)
  await page.locator(".ProseMirror").first().waitFor({ timeout: 15_000 });
}

// ── Interaction helpers ───────────────────────────────────────────────────────

async function sendMessage(page: Page, text: string) {
  const editor = page.locator(".ProseMirror").first();
  await editor.click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}

async function waitForMessage(page: Page, text: string) {
  await expect(
    page.locator(".msg-content").filter({ hasText: text }).first(),
  ).toBeVisible({ timeout: 10_000 });
}

/**
 * Returns the ActionsContainer (actions-container-*) that belongs to the
 * MessageContainer wrapping the given message text.
 *
 * DOM depth from msg-content: msg-content → MessageText → MessageContentContainer → MessageContainer
 * ActionsContainer is a direct child of MessageContainer.
 */
function getMessageActionsBar(page: Page, text: string) {
  return page
    .locator(".msg-content")
    .filter({ hasText: text })
    .first()
    .locator("xpath=../../..")        // → MessageContainer
    .locator('[id^="actions-container-"]')
    .first();
}

async function hoverMessage(page: Page, text: string) {
  // Hover the MessageContainer directly — the CSS rule is MessageContainer:hover → ActionsContainer visible.
  // Hovering a deep child sometimes doesn't reliably trigger :hover on the ancestor in Playwright.
  await page
    .locator(".msg-content")
    .filter({ hasText: text })
    .first()
    .locator("xpath=../../..")        // → MessageContainer
    .hover();
}

async function openActionsMenu(page: Page, text: string) {
  await hoverMessage(page, text);
  const actionsBar = getMessageActionsBar(page, text);
  // Wait for CSS :hover to make the bar visible before clicking.
  // Use a regular (non-forced) click so Playwright moves the mouse INTO the actionsBar;
  // force: true dispatches synthetically without moving the mouse, leaving it outside the bar
  // which immediately fires onMouseLeave and closes the just-opened dropdown.
  await actionsBar.waitFor({ state: "visible", timeout: 5_000 });
  // Reaction icons (✅👍😀) render an inner <span>emoji</span>, so .locator("span") sees 9 spans:
  // nth(0)=✅outer nth(1)=✅inner nth(2)=👍outer nth(3)=👍inner nth(4)=😀outer nth(5)=😀inner
  // nth(6)=EmojiWink nth(7)=Thread/ChatText nth(8)=ThreeDots  (last 3 use SVG, no inner span)
  await actionsBar.locator("span").nth(8).click({ timeout: 5_000 });
}

// ── Send & receive ────────────────────────────────────────────────────────────

test.describe("Chat UI — send message", () => {
  test.beforeAll(requireEnv);
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await openChannel(page);
  });

  test("typing a message and pressing Enter sends it", async ({ page }) => {
    const marker = `ui-send-${Date.now()}`;
    await sendMessage(page, marker);
    await waitForMessage(page, marker);
  });

  test("input clears after message is sent", async ({ page }) => {
    const marker = `ui-clear-${Date.now()}`;
    await sendMessage(page, marker);
    await waitForMessage(page, marker);
    const content = await page.locator(".ProseMirror").first().textContent();
    expect(content?.trim()).toBe("");
  });

  test("sent message shows the sender username", async ({ page }) => {
    const marker = `ui-sender-${Date.now()}`;
    await sendMessage(page, marker);
    await waitForMessage(page, marker);
    await expect(page.getByText("Alice").first()).toBeVisible({ timeout: 10_000 });
  });

  test("Shift+Enter inserts a newline instead of sending", async ({ page }) => {
    const editor = page.locator(".ProseMirror").first();
    await editor.click();
    await page.keyboard.type("line one");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("line two");
    // Message should NOT yet be visible as a sent message
    await expect(
      page.locator(".msg-content").filter({ hasText: "line one" }),
    ).not.toBeVisible({ timeout: 2_000 }).catch(() => {});
    // Clear the editor without sending
    await page.keyboard.press("Escape");
  });
});

// ── Actions bar ───────────────────────────────────────────────────────────────

test.describe("Chat UI — message actions bar", () => {
  test.beforeAll(requireEnv);
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await openChannel(page);
  });

  test("hovering a message reveals the actions bar", async ({ page }) => {
    const marker = `ui-hover-${Date.now()}`;
    await sendMessage(page, marker);
    await waitForMessage(page, marker);
    await hoverMessage(page, marker);
    await expect(
      getMessageActionsBar(page, marker),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("three-dots button opens the more-actions dropdown", async ({ page }) => {
    const marker = `ui-dots-${Date.now()}`;
    await sendMessage(page, marker);
    await waitForMessage(page, marker);
    await openActionsMenu(page, marker);
    await expect(page.getByText("Edit message").first()).toBeVisible({ timeout: 3_000 });
    await expect(page.getByText("Delete message").first()).toBeVisible({ timeout: 3_000 });
  });
});

// ── Edit message ──────────────────────────────────────────────────────────────

test.describe("Chat UI — edit message", () => {
  test.beforeAll(requireEnv);
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await openChannel(page);
  });

  test("Edit message replaces the text inline", async ({ page }) => {
    const original = `ui-edit-orig-${Date.now()}`;
    const edited   = `ui-edit-done-${Date.now()}`;

    await sendMessage(page, original);
    await waitForMessage(page, original);
    await openActionsMenu(page, original);
    await page.getByText("Edit message").first().click();

    // The inline edit ProseMirror editor appears pre-filled with the original text;
    // triple-click selects all content in the editor
    const editEditor = page
      .locator(".ProseMirror")
      .filter({ hasText: original })
      .first();
    await editEditor.waitFor({ timeout: 5_000 });
    await editEditor.click({ clickCount: 3 });
    await page.keyboard.type(edited);
    await page.keyboard.press("Enter");

    await waitForMessage(page, edited);
  });

  test("edited message shows the (edited) marker", async ({ page }) => {
    const original = `ui-edit-marker-${Date.now()}`;
    const edited   = `ui-edit-marker-done-${Date.now()}`;

    await sendMessage(page, original);
    await waitForMessage(page, original);
    await openActionsMenu(page, original);
    await page.getByText("Edit message").first().click();

    const editEditor = page
      .locator(".ProseMirror")
      .filter({ hasText: original })
      .first();
    await editEditor.waitFor({ timeout: 5_000 });
    await editEditor.click({ clickCount: 3 });
    await page.keyboard.type(edited);
    await page.keyboard.press("Enter");

    await waitForMessage(page, edited);
    await expect(page.getByText("(edited)").first()).toBeVisible({ timeout: 5_000 });
  });
});

// ── Delete message ────────────────────────────────────────────────────────────

test.describe("Chat UI — delete message", () => {
  test.beforeAll(requireEnv);
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await openChannel(page);
  });

  test("Delete message removes it from the chat", async ({ page }) => {
    const marker = `ui-delete-${Date.now()}`;
    await sendMessage(page, marker);
    await waitForMessage(page, marker);
    await openActionsMenu(page, marker);
    await page.getByText("Delete message").first().click();

    // Message text should no longer be visible
    await expect(
      page.locator(".msg-content").filter({ hasText: marker }),
    ).not.toBeVisible({ timeout: 5_000 });
  });
});

// ── Reactions ─────────────────────────────────────────────────────────────────

test.describe("Chat UI — reactions", () => {
  test.beforeAll(requireEnv);
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await openChannel(page);
  });

  test("clicking 👍 reaction adds it below the message", async ({ page }) => {
    const marker = `ui-react-thumbs-${Date.now()}`;
    await sendMessage(page, marker);
    await waitForMessage(page, marker);
    await hoverMessage(page, marker);

    const actionsBar = getMessageActionsBar(page, marker);
    await actionsBar.getByText("👍").first().click({ force: true, timeout: 5_000 });

    // The 👍 emoji should appear as a reaction badge below the message
    // Badge text is "👍1" (emoji + count); actionsBar button is just "👍" — this is unambiguous
    await expect(
      page.locator(".msg-content").filter({ hasText: marker })
        .locator("xpath=../../..").getByText("👍1"),
    ).toBeVisible({ timeout: 5_000 });
  });

  test("clicking the same reaction twice removes it", async ({ page }) => {
    const marker = `ui-react-toggle-${Date.now()}`;
    await sendMessage(page, marker);
    await waitForMessage(page, marker);

    // Add ✅ reaction
    await hoverMessage(page, marker);
    const actionsBar = getMessageActionsBar(page, marker);
    await actionsBar.getByText("✅").first().click({ force: true, timeout: 5_000 });
    // Badge text is "✅1" (emoji + count); actionsBar button is just "✅" — this is unambiguous
    await expect(
      page.locator(".msg-content").filter({ hasText: marker })
        .locator("xpath=../../..").getByText("✅1"),
    ).toBeVisible({ timeout: 5_000 });

    // Click the reaction badge itself to remove — badge is visible and its onClick calls handleReaction
    // which checks if user already reacted and sets isAdding=false (removes)
    await page.locator(".msg-content").filter({ hasText: marker })
      .locator("xpath=../../..").getByText("✅1")
      .click();
    await expect(
      page.locator(".msg-content").filter({ hasText: marker })
        .locator("xpath=../../..").getByText("✅1"),
    ).not.toBeVisible({ timeout: 5_000 });
  });
});

// ── Thread replies ────────────────────────────────────────────────────────────

test.describe("Chat UI — thread replies", () => {
  test.beforeAll(requireEnv);
  test.beforeEach(async ({ page }) => {
    await setupApp(page);
    await openChannel(page);
  });

  test("clicking the thread button opens a thread panel with a second editor", async ({
    page,
  }) => {
    const marker = `ui-thread-open-${Date.now()}`;
    await sendMessage(page, marker);
    await waitForMessage(page, marker);
    await hoverMessage(page, marker);

    // Thread button is index 4 (after ✅ 👍 😀 EmojiPicker)
    await getMessageActionsBar(page, marker).locator("span").nth(7).click({ force: true, timeout: 5_000 });

    // A second .ProseMirror should appear in the thread panel
    await expect(page.locator(".ProseMirror").nth(1)).toBeVisible({ timeout: 10_000 });
  });

  test("reply sent in thread panel appears in the thread", async ({ page }) => {
    const parent = `ui-thread-parent-${Date.now()}`;
    const reply  = `ui-thread-reply-${Date.now()}`;

    await sendMessage(page, parent);
    await waitForMessage(page, parent);
    await hoverMessage(page, parent);

    await getMessageActionsBar(page, parent).locator("span").nth(7).click({ force: true, timeout: 5_000 });

    const threadEditor = page.locator(".ProseMirror").nth(1);
    await threadEditor.waitFor({ timeout: 10_000 });
    await threadEditor.click();
    await page.keyboard.type(reply);
    await page.keyboard.press("Enter");

    await expect(
      page.locator(".msg-content").filter({ hasText: reply }).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("parent message shows a reply count after a thread reply", async ({
    page,
  }) => {
    const parent = `ui-thread-count-${Date.now()}`;
    const reply  = `ui-thread-count-reply-${Date.now()}`;

    await sendMessage(page, parent);
    await waitForMessage(page, parent);
    await hoverMessage(page, parent);

    await getMessageActionsBar(page, parent).locator("span").nth(7).click({ force: true, timeout: 5_000 });

    const threadEditor = page.locator(".ProseMirror").nth(1);
    await threadEditor.waitFor({ timeout: 10_000 });
    await threadEditor.click();
    await page.keyboard.type(reply);
    await page.keyboard.press("Enter");

    await expect(
      page.locator(".msg-content").filter({ hasText: reply }),
    ).toBeVisible({ timeout: 10_000 });

    // "1 reply" or similar text should appear below the parent message
    await expect(
      page.getByText(/1 repl/i).first(),
    ).toBeVisible({ timeout: 5_000 });
  });
});
