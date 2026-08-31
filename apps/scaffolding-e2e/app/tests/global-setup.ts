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
    // The stored value is now the raw JWT. It used to be JSON-stringified, and
    // `JSON.parse` on a raw JWT throws — which this function would have caught and
    // reported as "expired", quietly forcing a fresh login on every single run.
    const token = rawValue.startsWith('"') ? (JSON.parse(rawValue) as string) : rawValue;
    const payload = token.split(".")[1];
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf-8")) as { exp?: number };
    return !decoded.exp || decoded.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

function isSessionComplete(): boolean {
  if (!fs.existsSync(AUTH_FILE)) return false;
  try {
    const state = JSON.parse(fs.readFileSync(AUTH_FILE, "utf-8"));
    const origins: Array<{ origin: string; localStorage: Array<{ name: string; value: string }> }> =
      state.origins ?? [];
    const ls = origins.find((o) => o.origin.includes("localhost:5173"))?.localStorage ?? [];

    // mero-react's keys: raw strings under a `mero:` prefix, plus the token
    // store's `mero-tokens` pair. The previous SDK used `access-token` /
    // `context-id` and JSON-stringified every value.
    const accessTokenEntry = ls.find((e) => e.name === "mero:access_token");
    const hasContextId = ls.some((e) => e.name === "mero:context_id");

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

// If the app is in multi-context mode, auth-frontend returns tokens with no
// context_id. The app's useEffect then tries to auto-select the first context
// from the admin API. If no context exists yet (fresh node), the context id is
// never stored and the wait times out.
//
// This function: reads token + node URL from the browser's localStorage, calls
// the admin API to check for contexts, creates one if the list is empty, then
// writes the context id + identity directly into localStorage so the
// app picks them up on the next React render cycle.
async function ensureContextExists(
  page: import("@playwright/test").Page,
): Promise<void> {
  const { token, nodeUrl, appId } = await page.evaluate(() => ({
    // Raw strings now — no JSON.parse. Parsing a raw value throws, and throwing
    // here reads as "not logged in", which is a long way from the real cause.
    token: localStorage.getItem("mero:access_token"),
    nodeUrl: localStorage.getItem("mero:node_url"),
    appId: localStorage.getItem("mero:application_id"),
  }));

  if (!token || !nodeUrl) {
    throw new Error("[global-setup] No access token or node URL in localStorage after redirect.");
  }

  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  // Fetch existing contexts
  const ctxRes = await fetch(`${nodeUrl}/admin-api/contexts`, { headers });
  if (!ctxRes.ok) throw new Error(`[global-setup] GET /admin-api/contexts failed: ${ctxRes.status}`);

  const ctxBody = await ctxRes.json() as {
    data?: { contexts?: Array<{ id: string; applicationId: string }> };
  };
  const contexts = ctxBody?.data?.contexts ?? [];

  // Pick a matching context or the first one available
  const existing =
    (appId ? contexts.find((c) => c.applicationId === appId) : null) ?? contexts[0];

  let contextId: string;
  let memberPublicKey: string | undefined;

  if (existing) {
    console.log(`[global-setup] Using existing context: ${existing.id}`);
    contextId = existing.id;

    // Fetch identity for this context
    const idRes = await fetch(`${nodeUrl}/admin-api/contexts/${contextId}/identities-owned`, { headers });
    if (idRes.ok) {
      const idBody = await idRes.json() as { data?: { identities?: string[] } };
      memberPublicKey = idBody?.data?.identities?.[0];
    }
  } else {
    // No context exists — create one
    console.log("[global-setup] No context found — creating one via admin API…");

    if (!appId) throw new Error("[global-setup] No application-id in localStorage; cannot create context.");

    const createRes = await fetch(`${nodeUrl}/admin-api/contexts`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        applicationId: appId,
        protocol: "near",
        initializationParams: [],
      }),
    });
    if (!createRes.ok) {
      const text = await createRes.text();
      throw new Error(`[global-setup] POST /admin-api/contexts failed: ${createRes.status} ${text}`);
    }

    const createBody = await createRes.json() as {
      data?: { contextId?: string; memberPublicKey?: string };
    };
    contextId = createBody?.data?.contextId ?? "";
    memberPublicKey = createBody?.data?.memberPublicKey;

    if (!contextId) throw new Error("[global-setup] Context created but no contextId returned.");
    console.log(`[global-setup] Context created: ${contextId}`);
  }

  // Write the context id and identity into localStorage so the app picks them up
  await page.evaluate(
    ({ contextId, memberPublicKey }) => {
      localStorage.setItem("mero:context_id", contextId);
      if (memberPublicKey) {
        localStorage.setItem("mero:context_identity", memberPublicKey);
      }
    },
    { contextId, memberPublicKey },
  );
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

    // 2. ConnectScreen — fill node URL and connect
    await page.locator("input").waitFor({ timeout: 10_000 });
    await page.locator("input").fill(NODE_URL);
    await page.getByRole("button", { name: "Connect & Login" }).click();

    // 3. Wait for redirect to auth (URL leaves localhost:5173)
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

    // 5a. Optional: install the app if not already on the node
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

    // 6–8. Auth redirects back to the app, possibly via context/identity selectors
    let redirectedAlready = false;
    try {
      await page.waitForURL((url) => url.toString().includes("localhost:5173"), { timeout: 5_000 });
      redirectedAlready = true;
    } catch {
      // Not redirected yet — selectors may follow
    }

    if (!redirectedAlready) {
      // 6. Select first context (single-context flows only)
      try {
        await page.getByText("Select a context", { exact: true }).waitFor({ timeout: 15_000 });
        console.log("[global-setup] Selecting first context…");
        await page.locator('[data-testid="context-item"]').first().click();
      } catch {
        // No context selector in this flow
      }

      // 7. Select first identity
      try {
        await page.getByText("Select an identity", { exact: true }).waitFor({ timeout: 10_000 });
        console.log("[global-setup] Selecting first identity…");
        await page.locator('[data-testid="identity-item"]').first().click();
      } catch {
        // No identity selector in this flow
      }

      // 8. Wait for redirect back
      await page.waitForURL((url) => url.toString().includes("localhost:5173"), {
        timeout: 15_000,
      });
    }
    console.log("[global-setup] Redirected back to app.");

    // 9. In multi-context mode the JWT has no context_id. The app's useEffect
    //    auto-selects the first context, but only if one already exists.
    //    Wait up to 8s for the app to do it automatically; if it doesn't,
    //    create the context via the admin API and write the ID into localStorage.
    const autoSelected = await page
      .waitForFunction(
        () => {
          const raw = localStorage.getItem("mero:context_id");
          return !!raw && raw.length > 10;
        },
        { timeout: 8_000, polling: 500 },
      )
      .then(() => true)
      .catch(() => false);

    if (!autoSelected) {
      console.log("[global-setup] context id not set automatically — ensuring context exists…");
      // Debug: show what's in localStorage so key-name mismatches are visible
      const lsSnapshot = await page.evaluate(() => {
        const out: Record<string, string | null> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i)!;
          out[k] = localStorage.getItem(k);
        }
        return out;
      });
      console.log("[global-setup] localStorage snapshot:", JSON.stringify(lsSnapshot, null, 2));
      await ensureContextExists(page);
    }

    // 10. Final confirmation the context id is in localStorage
    const ctxId = await page.evaluate(() => localStorage.getItem("mero:context_id"));
    if (!ctxId || ctxId.length <= 10) {
      throw new Error("[global-setup] context id still missing after ensureContextExists.");
    }
    console.log(`[global-setup] context id set: ${ctxId}`);

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
