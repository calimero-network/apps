import { chromium, FullConfig, Page } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AUTH_FILE = path.join(__dirname, ".auth/state.json");
const APP_URL = "http://localhost:5173";

function isSessionComplete(): boolean {
  if (!fs.existsSync(AUTH_FILE)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
    const origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> =
      state.origins ?? [];
    const ls = origins.find((o) => o.origin.includes("localhost:5173"))?.localStorage ?? [];
    return ls.some((e) => e.name === "access-token") && ls.some((e) => e.name === "context-id");
  } catch {
    return false;
  }
}

async function snap(page: Page, name: string) {
  await page.screenshot({ path: path.join(__dirname, `.auth/${name}`) }).catch(() => {});
}

export default async function globalSetup(_config: FullConfig) {
  if (isSessionComplete()) {
    console.log("[global-setup] Reusing existing auth session.");
    return;
  }

  console.log("[global-setup] No valid session found. Opening browser for manual login…");
  console.log("[global-setup] → Navigate to the app, log in, and select a context.");
  console.log("[global-setup] → The setup will save your session once context-id appears in localStorage.");

  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  try {
    await page.goto(APP_URL);
  } catch {
    await browser.close();
    throw new Error(
      "[global-setup] Could not reach http://localhost:5173 — start the dev server first:\n" +
      "  cd scaffold-e2e/frontend && pnpm dev",
    );
  }

  // Wait up to 5 minutes for the user to complete auth manually.
  // We poll localStorage for access-token + context-id.
  const deadline = Date.now() + 5 * 60 * 1_000;
  let authenticated = false;

  while (Date.now() < deadline) {
    await page.waitForTimeout(1_000);

    // If we ended up at the node auth page and got redirected back, wait for app.
    if (!page.url().includes("localhost:5173")) continue;

    const hasCtx = await page
      .evaluate(() => {
        try {
          const raw = localStorage.getItem("context-id");
          if (!raw) return false;
          const val = JSON.parse(raw) as string;
          return val.length > 10;
        } catch {
          const raw = localStorage.getItem("context-id");
          return !!raw && raw.length > 10;
        }
      })
      .catch(() => false);

    if (hasCtx) {
      authenticated = true;
      break;
    }
  }

  if (!authenticated) {
    await snap(page, "auth-screen.png");
    await browser.close();
    throw new Error(
      "[global-setup] Timed out waiting for manual login. " +
      "Log in through the app, select a context, then re-run: pnpm run test:auth",
    );
  }

  const ctxId = await page.evaluate(() => localStorage.getItem("context-id"));
  console.log(`[global-setup] context-id set: ${ctxId}`);

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  await ctx.storageState({ path: AUTH_FILE });
  await browser.close();
  console.log(`[global-setup] Session saved → ${AUTH_FILE}`);
}
