#!/usr/bin/env node
/**
 * app/e2e/web-login.mjs — prove the plain web has a usable way in.
 *
 * This exists because it did not. `App` short-circuited on `APP_ENABLED` before
 * the router mounted, so with no session in the URL hash `RequireAuth` never ran
 * and mero-react's login was unreachable. The landing page told visitors to
 * install the desktop app because that was, accurately, the only door. Nothing in
 * the suite caught it: every other test arrives WITH a hash, which is exactly the
 * case that worked.
 *
 * So this test opens the app the way a stranger does — production build, no hash,
 * no desktop shell — and asserts there is a login to reach.
 *
 * Usage (from app/):
 *   node e2e/web-login.mjs --url http://127.0.0.1:5199
 */
// From @playwright/test, not the raw `playwright` package. Two copies at
// different versions makes the test runner fail with "Playwright Test did not
// expect test.describe() to be called here" — the catalog pins @playwright/test
// and this file pinned playwright itself, so a catalog bump desynced them.
// @playwright/test re-exports chromium, so one dependency covers both uses.
import { chromium } from "@playwright/test";

const argOf = (f) => {
  const i = process.argv.indexOf(f);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const URL_BASE = argOf("--url") ?? "http://127.0.0.1:5199";
const HEADLESS = process.env.HEADLESS !== "0";

const c = {
  step: (m) => console.log(`\n\x1b[1;36m▶  ${m}\x1b[0m`),
  ok: (m) => console.log(`\x1b[32m  ✓  ${m}\x1b[0m`),
  bad: (m) => console.error(`\x1b[31m  ✗  ${m}\x1b[0m`),
};
const failures = [];
const check = (cond, msg) => {
  cond ? c.ok(msg) : (failures.push(msg), c.bad(msg));
  return cond;
};

const browser = await chromium.launch({
  channel: "chrome",
  headless: HEADLESS,
});
const page = await browser.newPage();
const logs = [];
page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

try {
  c.step("Opening the app with NO hash and no desktop shell");
  await page.goto(URL_BASE, { waitUntil: "networkidle" });

  check((await page.title()) === "Mero Stream", "served Mero Stream");

  // The regression this guards: a dead page with nothing actionable on it.
  const connect = page.getByRole("button", { name: /connect/i });
  check(
    await connect.count().then((n) => n > 0),
    "a Connect control is present",
  );

  // And it must not be the old install-the-desktop-app dead end.
  const body = (await page.locator("body").innerText()).toLowerCase();
  check(
    !/only.*desktop|requires the desktop|open .*from the desktop app to/.test(
      body,
    ),
    "page does not claim the app is desktop-only",
  );

  c.step("Opening the login modal");
  await connect.first().click();

  // mero-react's LoginModal always shows node discovery + manual URL entry, so a
  // URL field is the load-bearing element: it is what lets someone point the app
  // at a node we cannot guess for them.
  const urlField = page
    .locator(
      'input[placeholder*="http" i], input[placeholder*="url" i], input[type="url"]',
    )
    .first();
  const appeared = await urlField
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  check(appeared, "login modal offers a node URL field");

  if (appeared) {
    await urlField.fill("http://127.0.0.1:2660");
    check(
      (await urlField.inputValue()) === "http://127.0.0.1:2660",
      "a node URL can actually be entered",
    );
  }

  check(
    logs.length === 0,
    `no page errors${logs.length ? `: ${logs[0]}` : ""}`,
  );

  // ── Optional: actually complete the login against a live node ──────────────
  // A rendered modal is not a working login. With --node we press Connect and
  // follow through: merod serves an embedded auth frontend, mero-react hands off
  // to it, and the credentials come back to us as a callback. Only reaching an
  // authenticated view proves the path.
  const nodeUrl = argOf("--node");
  if (appeared && nodeUrl) {
    c.step(`Signing in against ${nodeUrl}`);
    await urlField.fill(nodeUrl);
    await page.getByRole("button", { name: /^connect$/i }).click();

    const user = argOf("--user") ?? "admin";
    const pass = argOf("--pass") ?? "calimero1234";

    // merod serves an embedded auth frontend, and it opens on a PROVIDER PICKER
    // ("Choose an authentication method") rather than straight onto a form — a
    // node can expose several methods. Select user_password first; without this
    // step the password field legitimately does not exist yet, which reads as a
    // broken login when it is only an un-clicked menu.
    const provider = page
      .getByText(/username\/password|user_password/i)
      .first();
    if (
      await provider
        .waitFor({ state: "visible", timeout: 30_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      c.ok("node offered the user_password method");
      await provider.click();
    }

    const pw = page.locator('input[type="password"]').first();
    const gotForm = await pw
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    check(gotForm, "reached a username/password form on the node");

    if (gotForm) {
      const userField = page
        .locator(
          'input[name*="user" i], input[id*="user" i], input[placeholder*="user" i], input[type="text"]',
        )
        .first();
      if (await userField.count()) await userField.fill(user);
      await pw.fill(pass);
      await page
        .getByRole("button", { name: /sign in|log in|login|continue/i })
        .first()
        .click()
        .catch(() => page.keyboard.press("Enter"));

      // After credentials, mero-react resolves the app from the REGISTRY and
      // offers to install it on this node ("Mero Stream v0.1.0 … Install &
      // Continue"). It is a real step, not a splash: a freshly-initialised node
      // does not have the app yet, and this is what puts it there. Skipping the
      // click leaves you parked on the dialog, which looks like a failed login.
      const install = page.getByRole("button", {
        name: /install & continue|install and continue|install/i,
      });
      if (
        await install
          .first()
          .waitFor({ state: "visible", timeout: 45_000 })
          .then(() => true)
          .catch(() => false)
      ) {
        c.ok("registry resolved the app and offered to install it");
        await install.first().click();
      }

      // Then a permission-consent screen ("Review Permissions" — list/create
      // contexts, execute contracts, namespace/group/blob scopes). The approve
      // button sits below a long scrolling list, so scroll it into view rather
      // than assuming it is on screen.
      const approve = page
        .getByRole("button", { name: /approve|allow|grant|accept|continue/i })
        .last();
      if (
        await approve
          .waitFor({ state: "visible", timeout: 30_000 })
          .then(() => true)
          .catch(() => false)
      ) {
        c.ok("node asked for permission consent");
        await approve.scrollIntoViewIfNeeded().catch(() => {});
        await approve.click();
      }

      // Final step: the node shows the resolved Application ID and the granted
      // scopes, then mints the token pair. This is the click that actually hands
      // the session back to the app.
      const mint = page.getByRole("button", {
        name: /generate token|create token|finish|done/i,
      });
      if (
        await mint
          .first()
          .waitFor({ state: "visible", timeout: 30_000 })
          .then(() => true)
          .catch(() => false)
      ) {
        c.ok("node resolved the application id and offered to mint a token");
        await mint.first().click();
      }

      // Authenticated means the app itself renders — the stream picker or a
      // stream page — rather than the landing page's Connect control.
      const landed = await page
        .locator(
          '[data-testid="capture-toggle"], [data-testid="connect-actions"] , [class*="createBar"]',
        )
        .first()
        .waitFor({ state: "visible", timeout: 60_000 })
        .then(async () => {
          // Distinguish "reached the app" from "bounced back to the landing
          // page", which also matches a loose selector.
          const stillLanding = await page
            .locator('[data-testid="connect-actions"]')
            .count();
          return stillLanding === 0;
        })
        .catch(() => false);
      check(landed, "signed in and reached the app (not the landing page)");
    }
  }
} finally {
  await page
    .screenshot({ path: "../data/browser-call/web-login.png" })
    .catch(() => {});
  await browser.close();
}

if (failures.length) {
  c.step(`FAILED — ${failures.length} check(s)`);
  process.exit(1);
}
c.step("PASSED — the plain web has a login path");
