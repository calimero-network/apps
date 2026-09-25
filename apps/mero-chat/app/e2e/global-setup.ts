/**
 * Playwright global setup — automates the full ConnectButton → auth-frontend
 * → approve → redirect-back auth flow and saves the browser session so it can
 * be reused across all tests.
 *
 * Environment variables (all optional; if omitted the setup writes an empty
 * auth state and tests fall back to the token-injection helpers):
 *
 *   E2E_NODE_URL   — Calimero node URL  (default: http://localhost:2428)
 *   E2E_USERNAME   — auth-frontend username  (default: admin)
 *   E2E_PASSWORD   — auth-frontend password  (default: password)
 *
 * Run once manually:  pnpm exec playwright test --config=playwright.config.ts --setup-only
 * (or just run the suite — the setup fires automatically first)
 */

import { chromium, FullConfig } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const AUTH_FILE = path.join(__dirname, ".auth/state.json");
const APP_URL = process.env.VITE_APP_URL ?? "http://localhost:5173";
const NODE_URL = process.env.E2E_NODE_URL ?? "";
const USERNAME = process.env.E2E_USERNAME ?? "admin";
const PASSWORD = process.env.E2E_PASSWORD ?? "password";

function isTokenExpired(raw: string): boolean {
  try {
    const token = JSON.parse(raw) as string;
    const payload = token.split(".")[1];
    // JWT uses base64url (- and _ instead of + and /), must convert before decode
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "==".slice(0, (4 - (base64.length % 4)) % 4);
    const decoded = JSON.parse(
      Buffer.from(padded, "base64").toString("utf-8"),
    ) as { exp?: number };
    return !decoded.exp || decoded.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

function isSessionComplete(): boolean {
  if (!fs.existsSync(AUTH_FILE)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
    const origins: Array<{
      origin: string;
      localStorage: Array<{ name: string; value: string }>;
    }> = state.origins ?? [];
    const ls =
      origins.find((o) => o.origin.includes("localhost:5173"))?.localStorage ??
      [];

    const meroTokens = ls.find((e) => e.name === "mero-tokens")?.value;
    if (!meroTokens) return false;
    const tokens = JSON.parse(meroTokens) as { access_token?: string };
    if (!tokens.access_token) return false;

    // Treat an undecodable token as expired — real tokens from the node are
    // JWTs; mock tokens from tests would not be stored in the auth file.
    return !isTokenExpired(JSON.stringify(tokens.access_token));
  } catch {
    return false;
  }
}

export default async function globalSetup(_config: FullConfig) {
  // Only attempt auth when LIVE_AUTH=1 is explicitly set.
  // - rpc/rpc-admin: headless, no auth state needed (SKIP_DEV_SERVER=1)
  // - mocked: browser, but injects mock tokens per-test
  // - live: set LIVE_AUTH=1 → injects real tokens from env into auth state
  const skipReasons = [
    process.env.SKIP_DEV_SERVER && "SKIP_DEV_SERVER",
    process.env.INTEGRATION_MODE && "INTEGRATION_MODE",
  ].filter(Boolean);

  if (skipReasons.length) {
    console.log(`[global-setup] Skipping auth (${skipReasons.join(", ")}) — writing empty auth state.`);
    const emptyState = { cookies: [], origins: [] };
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(emptyState));
    return;
  }

  if (!NODE_URL) {
    console.log("[global-setup] E2E_NODE_URL not set — writing empty auth state.");
    const emptyState = { cookies: [], origins: [] };
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(emptyState));
    return;
  }

  // Fast path: inject tokens from .env.integration directly into the saved auth
  // state — no browser dance needed. The mero-react app reads these localStorage
  // keys on load (see main.tsx bridgeStorageOnLoad).
  const accessToken  = process.env.E2E_ACCESS_TOKEN  ?? "";
  const refreshToken = process.env.E2E_REFRESH_TOKEN ?? "";
  if (accessToken && !isTokenExpired(JSON.stringify(accessToken))) {
    console.log("[global-setup] Injecting tokens from env into auth state (no browser flow).");
    // MeroProvider's internal `LocalStorageTokenStore()` reads tokens from
    // the single JSON blob at `mero-tokens` — not from individual keys.
    const tokens = JSON.stringify({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: Date.now() + 3600_000,
    });
    const state = {
      cookies: [],
      origins: [
        {
          origin: APP_URL,
          localStorage: [
            { name: "mero:node_url", value: NODE_URL },
            { name: "mero-tokens",   value: tokens },
          ],
        },
      ],
    };
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(state));
    console.log(`[global-setup] Auth state written → ${AUTH_FILE}`);
    return;
  }

  // Reuse cached session if it's still valid (rare — only after a prior live run).
  if (isSessionComplete()) {
    console.log("[global-setup] Reusing cached auth session.");
    return;
  }

  // Default: env tokens are missing/expired. Write empty auth state and let
  // mocked tests inject their own per-test tokens. Live/rpc projects set
  // SKIP_DEV_SERVER=1 and don't hit this path. The browser auth fallback below
  // is opt-in (E2E_LIVE_AUTH=1) — running it by default blocks 15s when
  // auth-frontend isn't reachable, which breaks routine ci-local.sh runs.
  if (!process.env.E2E_LIVE_AUTH) {
    console.log("[global-setup] No valid token in env — writing empty auth state. Set E2E_LIVE_AUTH=1 to attempt browser auth.");
    const emptyState = { cookies: [], origins: [] };
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    fs.writeFileSync(AUTH_FILE, JSON.stringify(emptyState));
    return;
  }

  console.log("[global-setup] No valid token in env — falling back to browser auth flow (E2E_LIVE_AUTH=1).");

  console.log("[global-setup] Starting automated auth flow…");
  console.log(`[global-setup]  App:  ${APP_URL}`);
  console.log(`[global-setup]  Node: ${NODE_URL}  /  User: ${USERNAME}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  try {
    // 1. Open the app
    try {
      await page.goto(APP_URL, { waitUntil: "networkidle" });
    } catch {
      throw new Error(
        "[global-setup] Could not reach " +
          APP_URL +
          " — start the dev server first:\n  cd app && pnpm dev",
      );
    }

    // 2. Wait for the landing page and click ConnectButton
    await page
      .getByRole("heading", { level: 1 })
      .waitFor({ timeout: 20_000 });

    // ConnectButton is rendered as a button or anchor by mero-react.
    // It typically contains "Connect" in its accessible name.
    const connectBtn = page
      .getByRole("button", { name: /connect/i })
      .or(page.getByRole("link", { name: /connect/i }))
      .first();

    await connectBtn.waitFor({ timeout: 10_000 });
    await connectBtn.click();
    console.log("[global-setup] ConnectButton clicked.");

    // 3. Wait for redirect away from the app (to auth-frontend)
    await page.waitForURL(
      (url) => !url.toString().includes(new URL(APP_URL).host),
      { timeout: 15_000 },
    );
    console.log("[global-setup] Redirected to auth:", page.url());

    // 4. Fill node URL if the auth-frontend shows an input for it
    const nodeInput = page.locator("input").first();
    try {
      await nodeInput.waitFor({ timeout: 5_000 });
      await nodeInput.fill(NODE_URL);
      const continueBtn = page
        .getByRole("button", { name: /connect|continue/i })
        .first();
      await continueBtn.click();
      console.log("[global-setup] Node URL submitted.");
      // Wait to see if we stay on auth page for credentials
      await page.waitForTimeout(1_000);
    } catch {
      // Some auth flows skip the node URL step
    }

    // 5. Provider selection — pick Username/Password if a selector appears
    try {
      await page.getByText("Username/Password").waitFor({ timeout: 8_000 });
      await page.getByText("Username/Password").click();
      console.log("[global-setup] Username/Password provider selected.");
    } catch {
      // Single-provider flow — no selection screen
    }

    // 6. Fill credentials
    const usernameInput = page.locator("#username, input[name='username'], input[type='text']").first();
    const passwordInput = page.locator("#password, input[name='password'], input[type='password']").first();
    await usernameInput.waitFor({ timeout: 10_000 });
    await usernameInput.fill(USERNAME);
    await passwordInput.fill(PASSWORD);
    await page.getByRole("button", { name: /sign in|login|submit/i }).click();
    console.log("[global-setup] Credentials submitted.");

    // 7. Optional: install app if not already on the node
    try {
      await page
        .getByRole("button", { name: /install/i })
        .waitFor({ timeout: 8_000 });
      await page.getByRole("button", { name: /install/i }).click();
      console.log("[global-setup] Application installed.");
    } catch {
      // Already installed
    }

    // 8. Approve permissions
    await page
      .getByRole("button", { name: /approve/i })
      .waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: /approve/i }).click();
    console.log("[global-setup] Permissions approved.");

    // 9. Wait for redirect back to the app
    await page.waitForURL(
      (url) => url.toString().includes(new URL(APP_URL).host),
      { timeout: 20_000 },
    );
    console.log("[global-setup] Redirected back to app.");

    // 10. Confirm mero-react tokens are in localStorage
    const tokensSet = await page
      .waitForFunction(
        () => {
          const raw = localStorage.getItem("mero-tokens");
          if (!raw) return false;
          try {
            const t = JSON.parse(raw) as { access_token?: string };
            return !!t.access_token;
          } catch {
            return false;
          }
        },
        { timeout: 10_000, polling: 500 },
      )
      .then(() => true)
      .catch(() => false);

    if (!tokensSet) {
      const ls = await page.evaluate(() => {
        const out: Record<string, string | null> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)!;
          out[k] = localStorage.getItem(k);
        }
        return out;
      });
      console.error("[global-setup] localStorage after redirect:", ls);
      throw new Error(
        "[global-setup] mero-tokens not found in localStorage after auth.",
      );
    }

    // 11. Save session
    fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
    await ctx.storageState({ path: AUTH_FILE });
    console.log(`[global-setup] Session saved → ${AUTH_FILE}`);
  } catch (err) {
    await page
      .screenshot({ path: path.join(__dirname, ".auth/auth-failure.png") })
      .catch(() => {});
    await browser.close();
    throw err;
  }

  await browser.close();
}
