import { expect, test } from "@playwright/test";
import { appContextOptions, defaultLogin, readClipboard, rig, type Actor } from "@calimero-apps/e2e-node/journey";
import { passLockScreen } from "./lockScreen";

// One person, one real node: the theme switch inside the app, the password
// generator, a masked password copied to the clipboard, and Log out — which
// has to leave nothing behind that opens a vault: the session gone, the vault
// keys locked, and the copied password off the clipboard at once rather than
// 30 seconds later — and the browser's Back button must not reopen the app.

const SESSION_KEYS = () =>
  Object.keys(localStorage).filter((k) => k === "mero-tokens" || /^mero:.*token/.test(k));

test("mero-pass: theme, generator, copy, then Log out leaves nothing behind", async ({ browser }) => {
  test.setTimeout(5 * 60_000);
  const node = rig().nodes[0];
  if (!node) throw new Error("the rig has no node");
  const context = await browser.newContext({ ...(await appContextOptions(node)), permissions: ["clipboard-read", "clipboard-write"] });
  const page = await context.newPage();
  const actor: Actor = { name: "alice", page, node, run: `s${Date.now().toString(36)}` };

  try {
    await page.goto("/");
    await defaultLogin(actor);
    await expect(page.getByRole("heading", { level: 1, name: "Your vaults" })).toBeVisible({ timeout: 60_000 });

    await test.step("the app opens light; the top-bar switch goes dark and stays dark", async () => {
      const html = page.locator("html");
      await expect(html).not.toHaveAttribute("data-theme", "dark");
      await page.getByTestId("theme-toggle").click();
      await expect(html).toHaveAttribute("data-theme", "dark");
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Your vaults" })).toBeVisible({ timeout: 60_000 });
      await expect(html).toHaveAttribute("data-theme", "dark");
      await page.getByTestId("theme-toggle").click();
      await expect(html).toHaveAttribute("data-theme", "light");
    });

    await test.step("open the private vault", async () => {
      const create = page.getByTestId("personal-create");
      const card = page.getByTestId("personal-card");
      await expect(create.or(card)).toBeVisible({ timeout: 60_000 });
      if (await create.isVisible()) {
        await expect(create).toBeEnabled({ timeout: 30_000 });
        await create.click();
      } else {
        await card.click();
      }
      await expect(page).toHaveURL(/\/vault\/[^/]+/, { timeout: 90_000 });
      // A new browser protects its key and saves a recovery key first.
      await passLockScreen(page, "secret-add");
      await expect(page.getByTestId("secret-add")).toBeEnabled({ timeout: 90_000 });
      await expect(page.getByTestId("lock-state")).toContainText("Unlocked");
    });

    const name = `login-${actor.run}`;
    let password = "";
    await test.step("generate a password for a new login, and save it", async () => {
      await page.getByTestId("secret-add").click();
      const form = page.getByTestId("secret-form");
      await expect(form).toBeVisible();
      await form.getByTestId("sf-name").fill(name);
      await form.getByTestId("sf-username").fill("ada@example.com");
      await form.getByTestId("sf-generate").click();
      password = await form.getByTestId("sf-password").inputValue();
      expect(password).toHaveLength(20);
      // Generated into a concealed field: the value is not on screen.
      await expect(form.getByTestId("sf-password")).toHaveAttribute("type", "password");
      await form.getByTestId("sf-save").click();
      await expect(form).toBeHidden({ timeout: 30_000 });
    });

    await test.step("the password is masked, and copying it puts it on the clipboard", async () => {
      await page.getByTestId("secret-row").filter({ hasText: name }).first().click();
      const detail = page.getByTestId("item-detail");
      await expect(detail.getByTestId("item-name")).toHaveText(name);
      await expect(detail.getByTestId("field-hidden")).toHaveText(/^•+$/);
      await expect(detail).not.toContainText(password);
      await detail.getByTestId("copy-password").click();
      await expect.poll(() => readClipboard(page)).toBe(password);
    });

    await test.step("Log out: session ended, vault keys locked, clipboard cleared now", async () => {
      await page.getByTestId("logout").click();
      await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
      await expect(page.getByTestId("landing")).toBeVisible();
      expect(await page.evaluate(SESSION_KEYS)).toEqual([]);
      // Well inside the 30-second timer: the clear ran on log out.
      await expect.poll(() => readClipboard(page), { timeout: 5_000 }).toBe("");
      await page.reload();
      await expect(page.getByTestId("landing")).toBeVisible();
      expect(await page.evaluate(SESSION_KEYS)).toEqual([]);
    });

    await test.step("Back after Log out returns to the front door, not an empty app frame", async () => {
      // The vault page Log out replaced is gone; the in-app page before it is
      // still in history. Its route's sign-in guard sends it to `/`.
      await page.goBack();
      await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
      await expect(page.getByTestId("landing")).toBeVisible();
      await expect(page.getByTestId("theme-toggle")).toHaveCount(0);
      await expect(page.getByTestId("logout")).toHaveCount(0);
    });
  } finally {
    await context.close();
  }
});
