import { chromium, FullConfig } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_FILE = path.join(__dirname, ".auth/state.json");
const APP_URL = "http://localhost:5173";
const NODE_URL = process.env.E2E_NODE_URL ?? "http://localhost:2528";
const USERNAME = process.env.E2E_USERNAME ?? "admin";
const PASSWORD = process.env.E2E_PASSWORD ?? "password";

function isTokenExpired(rawValue: string): boolean {
  try {
    const token = JSON.parse(rawValue) as string;     // stored as JSON string
    const payload = token.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf-8")) as { exp?: number };
    return !decoded.exp || decoded.exp * 1000 < Date.now();
  } catch {
    return true; // can't decode → treat as expired
  }
}

function isSessionComplete(): boolean {
  if (!fs.existsSync(AUTH_FILE)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
    const origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> =
      state.origins ?? [];
    const ls = origins.find((o) => o.origin.includes("localhost:5173"))?.localStorage ?? [];

    const accessTokenEntry = ls.find((e) => e.name === "access-token");
    const hasContextId = ls.some((e) => e.name === "context-id");

    if (!accessTokenEntry || !hasContextId) return false;

    if (isTokenExpired(accessTokenEntry.value)) {
      console.log("[global-setup] Cached access token is expired — re-authenticating.");
      return false;
    }

    return true;
  } catch {
    return false;
  }
}


export default async function globalSetup(_config: FullConfig) {
  if (isSessionComplete()) {
    console.log("[global-setup] Reusing existing auth session.");
    return;
  }

  console.log("[global-setup] Starting automated auth flow…");
  console.log(`[global-setup] Node: ${NODE_URL}  User: ${USERNAME}`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  try {
    // 1. Open the app
    try {
      await page.goto(APP_URL);
    } catch {
      throw new Error(
        "[global-setup] Could not reach http://localhost:5173 — start the dev server first:\n" +
          "  cd calimero-scaffolding-e2e-application/frontend && pnpm dev",
      );
    }

    // 2. ConnectScreen — fill node URL (pre-filled from VITE_NODE_URL but set explicitly) and connect
    await page.locator("input").waitFor({ timeout: 10_000 });
    await page.locator("input").fill(NODE_URL);
    await page.getByRole("button", { name: "Connect & Login" }).click();

    // 3. Wait for redirect to auth-frontend (URL leaves localhost:5173)
    await page.waitForURL((url) => !url.toString().includes("localhost:5173"), {
      timeout: 15_000,
    });
    console.log("[global-setup] Redirected to auth:", page.url());

    // 4. Provider selection → credentials
    await page.getByText("Username/Password").waitFor({ timeout: 15_000 });
    await page.getByText("Username/Password").click();
    await page.locator("#username").fill(USERNAME);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign In" }).click();
    console.log("[global-setup] Credentials submitted.");

    // 5a. Optional: install the app if it isn't already on the node
    try {
      await page.getByRole("button", { name: "Install & Continue" }).waitFor({ timeout: 8_000 });
      await page.getByRole("button", { name: "Install & Continue" }).click();
      console.log("[global-setup] Application installed.");
    } catch {
      // Already installed — nothing to do
    }

    // 5b. Approve permissions
    await page.getByRole("button", { name: "Approve Permissions" }).waitFor({ timeout: 30_000 });
    await page.getByRole("button", { name: "Approve Permissions" }).click();
    console.log("[global-setup] Permissions approved.");

    // 6–8. After "Approve Permissions", auth-frontend either redirects directly back to
    //      the app (multi-context / single context auto-select) or shows context/identity
    //      selectors first. Try a short redirect wait first; if it doesn't happen, work
    //      through the selectors.
    let redirectedAlready = false;
    try {
      await page.waitForURL((url) => url.toString().includes("localhost:5173"), { timeout: 5_000 });
      redirectedAlready = true;
    } catch {
      // Not redirected yet — selectors may follow
    }

    if (!redirectedAlready) {
      // 6. Select first available context (optional — only in single-context flows)
      try {
        await page.getByText("Select a context", { exact: true }).waitFor({ timeout: 15_000 });
        console.log("[global-setup] Selecting first context…");
        await page.locator('[data-testid="context-item"]').first().click();
      } catch {
        // No context selector in this flow
      }

      // 7. Select first available identity (optional)
      try {
        await page.getByText("Select an identity", { exact: true }).waitFor({ timeout: 10_000 });
        console.log("[global-setup] Selecting first identity…");
        await page.locator('[data-testid="identity-item"]').first().click();
      } catch {
        // No identity selector in this flow
      }

      // 8. Wait for redirect back to the app
      await page.waitForURL((url) => url.toString().includes("localhost:5173"), {
        timeout: 15_000,
      });
    }
    console.log("[global-setup] Redirected back to app.");

    // 9. Wait for calimero-client to process the hash and store context-id
    await page.waitForFunction(
      () => {
        const raw = localStorage.getItem("context-id");
        return !!raw && raw.length > 10;
      },
      { timeout: 30_000, polling: 500 },
    );

    const ctxId = await page.evaluate(() => localStorage.getItem("context-id"));
    console.log(`[global-setup] context-id set: ${ctxId}`);

    // 10. Save session
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
