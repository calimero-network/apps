// The account chrome and the signing dialogs, against a real node: the
// light/dark switch in the signed-in top bar, dialogs that cover the whole
// window, the signature picker fully on screen on a desktop and a phone, and
// Log out — from the rail on a desktop and from the menu drawer on a phone.
// Either way the session is gone (mero-react's tokens and this app's own
// selection), the visitor is back on the landing page, and a reload or a deep
// link into the app does not sneak them back in.
//
// Runs on the journey rig (playwright.journey.config.ts), on node 1, before
// the lifecycle file; it creates one workspace of its own and leaves the
// lifecycle's before/after namespace counts alone, which are relative.
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { defaultLogin, rig, type Actor } from "@calimero-apps/e2e-node/journey";

test.describe.configure({ mode: "serial" });

const THEME_KEY = "mero-sign:theme";

async function signIn(browser: Browser, viewport?: { width: number; height: number }) {
  const node = rig().nodes[0];
  if (!node) throw new Error("the rig has no node");
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const actor: Actor = { name: "alice", page, node, run: `a${Date.now().toString(36)}` };
  await page.goto("/");
  await defaultLogin(actor);
  await expect(page.getByRole("heading", { level: 1, name: "Your workspaces" })).toBeVisible({
    timeout: 60_000,
  });
  return { page, context, actor };
}

async function expectSignedOut(page: Page) {
  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
  await expect(page.locator(".cal-lp-root")).toBeVisible({ timeout: 15_000 });
  const left = await page.evaluate(() => ({
    accessToken: localStorage.getItem("mero:access_token"),
    refreshToken: localStorage.getItem("mero:refresh_token"),
    workspace: localStorage.getItem("mero-sign:workspace"),
    agreement: localStorage.getItem("agreementContextID"),
  }));
  expect(left).toEqual({ accessToken: null, refreshToken: null, workspace: null, agreement: null });

  // Still signed out after a reload, and an app route asks to connect.
  await page.reload();
  await expect(page.locator(".cal-lp-root")).toBeVisible({ timeout: 15_000 });
  await page.goto("/workspaces");
  await expect(page.getByTestId("connect-cta")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("logout")).toHaveCount(0);
}

/** A dialog's scrim covers the whole window, the top bar included. A
 *  `backdrop-filter` on an ancestor (the frosted rail and top bar have one)
 *  would shrink a fixed scrim to that ancestor's box. */
async function expectCoversViewport(page: Page, dialog: Locator = page.getByRole("dialog")) {
  const box = await dialog.evaluate((el) => el.parentElement!.getBoundingClientRect().toJSON());
  const vp = page.viewportSize()!;
  expect(box.x).toBeLessThanOrEqual(0);
  expect(box.y).toBeLessThanOrEqual(0);
  expect(box.width).toBeGreaterThanOrEqual(vp.width);
  expect(box.height).toBeGreaterThanOrEqual(vp.height);
}

/** Entirely inside the window once it has finished opening (sheets slide
 *  in): nothing clipped, nothing off-screen. */
async function expectOnScreen(page: Page, el: Locator) {
  await expect(el).toBeVisible();
  const vp = page.viewportSize()!;
  await expect
    .poll(async () => {
      const box = await el.boundingBox();
      if (!box) return "no box";
      const out = [];
      if (box.x < 0) out.push(`left ${box.x}`);
      if (box.y < 0) out.push(`top ${box.y}`);
      if (box.x + box.width > vp.width + 0.5) out.push(`right ${box.x + box.width}`);
      if (box.y + box.height > vp.height + 0.5) out.push(`bottom ${box.y + box.height}`);
      return out.join(", ") || "on screen";
    })
    .toBe("on screen");
}

/** A one-page PDF the viewer can open. */
function onePagePdf(): Buffer {
  const content = "BT /F1 18 Tf 72 700 Td (Mutual NDA) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

test("the top-bar switch: light by default, dark on a press, kept across a reload", async ({ browser }) => {
  const { page, context } = await signIn(browser);
  try {
    const html = page.locator("html");
    const toggle = page.getByTestId("theme-toggle");
    await expect(html).toHaveAttribute("data-theme", "light");
    await expect(toggle).toHaveAttribute("aria-label", "Use dark theme");

    await toggle.click();
    await expect(html).toHaveAttribute("data-theme", "dark");
    expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe("dark");

    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Your workspaces" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(html).toHaveAttribute("data-theme", "dark");
    await expect(page.getByTestId("theme-toggle")).toHaveAttribute("aria-label", "Use light theme");

    await page.getByTestId("theme-toggle").click();
    await expect(html).toHaveAttribute("data-theme", "light");
  } finally {
    await context.close();
  }
});

test("Log out in the rail ends the session and returns to the landing page", async ({ browser }) => {
  const { page, context, actor } = await signIn(browser, { width: 1280, height: 800 });
  try {
    // A workspace, so there is a real dialog to open: its scrim must cover the
    // frosted top bar as well as the page.
    await page.getByTestId("new-workspace-name").fill(`account-${actor.run}`);
    await expect(page.getByTestId("create-workspace")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("create-workspace").click();
    await expect(page).toHaveURL(/\/workspaces\/[^/]+/, { timeout: 60_000 });
    await page.getByTestId("back").click();
    const card = page.getByTestId("workspace-card").filter({ hasText: `account-${actor.run}` });
    await card.getByTitle("More options").click();
    await page.getByTestId("invite-to-workspace").click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectCoversViewport(page);
    await page.getByRole("button", { name: "Done", exact: true }).click();

    // The theme choice belongs to the browser, so it outlives the session.
    await page.getByTestId("theme-toggle").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    await expect(page.getByTestId("logout")).toBeVisible();
    await page.getByTestId("logout").click();
    await expectSignedOut(page);
    expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe("dark");
  } finally {
    await context.close();
  }
});

test("on a phone, Log out is in the menu drawer the top bar opens", async ({ browser }) => {
  const { page, context } = await signIn(browser, { width: 390, height: 844 });
  try {
    // No rail on a phone: the navigation lives behind the menu button.
    await expect(page.getByTestId("nav-signatures").first()).toBeHidden();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.getByTestId("mobile-nav-btn").click();
    const drawer = page.getByTestId("mobile-nav");
    await expect(drawer).toBeVisible();
    // Navigating closes the drawer.
    await drawer.getByTestId("nav-signatures").click();
    await expect(page).toHaveURL(/\/signatures$/);
    await expect(drawer).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: "Your signatures" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

    await page.getByTestId("mobile-nav-btn").click();
    await page.getByTestId("mobile-nav").getByTestId("logout").click();
    await expectSignedOut(page);
  } finally {
    await context.close();
  }
});

test("the signature picker and pad are fully on screen, on a desktop and a phone", async ({ browser }) => {
  const { page, context, actor } = await signIn(browser, { width: 1280, height: 800 });
  try {
    // A workspace, an agreement in it, and a document in that.
    await page.getByTestId("new-workspace-name").fill(`sign-${actor.run}`);
    await expect(page.getByTestId("create-workspace")).toBeEnabled({ timeout: 30_000 });
    await page.getByTestId("create-workspace").click();
    await expect(page).toHaveURL(/\/workspaces\/[^/]+/, { timeout: 60_000 });
    await page.getByTestId("new-agreement-name").fill(`nda-${actor.run}`);
    await page.getByTestId("create-agreement").click();
    const open = page.getByTestId("agreement-card").filter({ hasText: `nda-${actor.run}` }).getByRole("button").first();
    await expect(open).toBeEnabled({ timeout: 60_000 });
    await open.click();
    await expect(page.getByTestId("agreement-title")).toHaveText(`nda-${actor.run}`, { timeout: 60_000 });
    await page.getByTestId("open-upload").click();
    await page.getByTestId("upload-input").setInputFiles({
      name: "nda.pdf",
      mimeType: "application/pdf",
      buffer: onePagePdf(),
    });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    await page.getByTestId("document-card").filter({ hasText: "nda.pdf" }).getByRole("button").first().click();
    await expect(page.getByTestId("pdf-page")).toBeVisible({ timeout: 60_000 });

    // Desktop: first signature asks for consent, then offers the picker.
    await page.getByTestId("sign-document").click();
    await expectOnScreen(page, page.getByTestId("consent-dialog"));
    await page.getByTestId("consent-checkbox").check();
    await page.getByTestId("consent-accept").click();
    const picker = page.getByTestId("signature-picker");
    await expectOnScreen(page, picker);
    await expectCoversViewport(page, picker);
    await page.keyboard.press("Escape");
    await expect(picker).toHaveCount(0);
    // Escape closed the picker, not the document under it.
    await expect(page.getByTestId("pdf-page")).toBeVisible();

    // Phone: the same, from the actions button, as a bottom sheet.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Open document actions" }).click();
    await page.getByTestId("sign-document-mobile").click();
    await expectOnScreen(page, picker);
    await expectCoversViewport(page, picker);
    await page.getByTestId("draw-signature").click();
    const pad = page.getByTestId("signature-pad");
    await expectOnScreen(page, pad);
    await expectOnScreen(page, page.getByTestId("save-signature"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  } finally {
    await context.close();
  }
});
