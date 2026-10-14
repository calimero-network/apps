/**
 * The context page on a phone (390px), against a real merod.
 *
 * Two things the desktop layout gets right and a single column used to lose:
 * a first-time visitor finds where to set their name without scrolling past
 * every poll, and a poll's trustees read without scrolling sideways.
 *
 * Each test opens its own fresh context: the setup context is shared, and once
 * any spec joins its roster there is no first-time user left in it.
 */
import { expect, test } from "@playwright/test";
import { btn, card, freshContext, login, uniqueTitle, waitForPanel, watchForErrors } from "./helpers";

const PHONE = { width: 390, height: 844 };
const TIMEOUT = 30_000;

test.describe("phone layout", () => {
  test.use({ viewport: PHONE });

  test("a visitor with no name sees where to set it before the polls", async ({ page }) => {
    await login(page, { contextId: await freshContext() });
    await waitForPanel(page);
    const watch = watchForErrors(page);

    const nameInput = page.getByLabel("Your name");
    await expect(nameInput).toBeVisible({ timeout: TIMEOUT });
    // At the top, with no scrolling: above the Polls panel and inside the first screen.
    const input = (await nameInput.boundingBox())!;
    const polls = (await card(page, "Polls").boundingBox())!;
    expect(input.y, "the name field sits above the Polls panel").toBeLessThan(polls.y);
    expect(input.y + input.height, "the name field is inside the first viewport").toBeLessThanOrEqual(PHONE.height);

    // Once named, the card goes back below the polls, where it is on desktop.
    await nameInput.fill("Ada");
    await btn(page, "Join roster").click();
    await expect(card(page, "You")).toContainText("Ada", { timeout: TIMEOUT });
    const you = (await card(page, "You").boundingBox())!;
    const pollsAfter = (await card(page, "Polls").boundingBox())!;
    expect(you.y).toBeGreaterThan(pollsAfter.y);

    watch.assertClean();
  });

  test("a poll's trustees fit the screen, every status visible without sideways scrolling", async ({ page }) => {
    await login(page, { contextId: await freshContext() });
    await waitForPanel(page);
    const watch = watchForErrors(page);

    await page.getByLabel("Your name").fill("Ada Lovelace");
    await btn(page, "Join roster").click();
    await expect(card(page, "You")).toContainText("Ada Lovelace", { timeout: TIMEOUT });

    const title = uniqueTitle("Phone");
    await btn(page, "New poll").click();
    await page.getByPlaceholder("Where do we hold the offsite?").fill(title);
    await page.getByRole("textbox", { name: "Option 1", exact: true }).fill("Yes");
    await page.getByRole("textbox", { name: "Option 2", exact: true }).fill("No");
    await btn(page, "Create poll").click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: TIMEOUT });
    await btn(page, "Publish my transport key").click();
    await expect(page.getByText("Transport key published.")).toBeVisible({ timeout: TIMEOUT });

    const trustees = card(page, "Trustees");
    await expect(trustees.getByText("Published", { exact: true })).toBeVisible({ timeout: TIMEOUT });

    // Nothing in the card scrolls sideways.
    const scrollers = await trustees.evaluate((root) =>
      [root, ...root.querySelectorAll<HTMLElement>("*")]
        .filter((el) => /auto|scroll/.test(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className} ${el.scrollWidth}>${el.clientWidth}`),
    );
    expect(scrollers, "elements in the Trustees card that scroll sideways").toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(PHONE.width);

    // Every status lies inside the card, and each says which step it is for.
    const box = (await trustees.boundingBox())!;
    const statuses = trustees.locator(".status");
    await expect(statuses).toHaveCount(3);
    for (const s of await statuses.all()) {
      const b = (await s.boundingBox())!;
      expect(b.x).toBeGreaterThanOrEqual(box.x);
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width);
    }
    for (const label of ["Transport key", "Shares dealt", "Decryption"]) {
      await expect(trustees.getByText(label, { exact: true }).filter({ visible: true })).toHaveCount(1);
    }

    watch.assertClean();
  });
});
