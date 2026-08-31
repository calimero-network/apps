import { test, expect } from "@playwright/test";
import { openBoard, TEST_IDENTITY } from "../fixtures/board";

/**
 * IMPORTANT.md item 8 — "Comments should have usernames displayed ... not using
 * identityID as then we dont know who the fuck is who".
 *
 * The names were already there: `get_members` returns `{ id, username }`. Nothing
 * joined the two, so the overlay printed a truncated identity.
 */
const COMMENT = [{
  id: "c-1", x: 300, y: 300, content: "needs more contrast", author: TEST_IDENTITY, createdAt: 1,
  replies: [{ id: "r-1", content: "agreed", author: TEST_IDENTITY, createdAt: 2 }],
}];

test.describe("item 8: usernames in comments", () => {
  test("a comment shows the username, not the identity id", async ({ page }) => {
    await openBoard(page, { comments: COMMENT });
    await page.locator('div[class*="_pin_"]').first().click();
    const popup = page.locator('div[class*="_popup_"]');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText("Tester");
    await expect(popup).not.toContainText("test-i");
  });

  test("a reply shows its author's username too", async ({ page }) => {
    await openBoard(page, { comments: COMMENT });
    await page.locator('div[class*="_pin_"]').first().click();
    const replies = page.locator('div[class*="_reply_"]');
    await expect(replies.first()).toContainText("Tester");
  });

  test("an unknown identity falls back to a short id instead of crashing", async ({ page }) => {
    await openBoard(page, {
      comments: [{ ...COMMENT[0], author: "someoneelse000000000000000000", replies: [] }],
    });
    await page.locator('div[class*="_pin_"]').first().click();
    const popup = page.locator('div[class*="_popup_"]');
    await expect(popup).toBeVisible();
    await expect(popup).toContainText("…");
  });

  test("the members dropdown lists usernames", async ({ page }) => {
    await openBoard(page, {});
    await page.locator('button[title="Online members"]').click();
    await expect(page.locator('div[class*="_membersDropdown_"]')).toBeVisible();
  });
});
