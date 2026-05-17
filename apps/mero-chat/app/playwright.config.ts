import { defineConfig, devices } from "@playwright/test";
import path from "path";
import fs from "fs";

const __dirname = import.meta.dirname;
const AUTH_FILE = path.join(__dirname, "e2e/.auth/state.json");

// Load app/.env.integration into process.env so integration test workers can
// read E2E_* vars via getIntegrationEnv() without any extra setup in CI.
const integrationEnvPath = path.join(__dirname, ".env.integration");
if (fs.existsSync(integrationEnvPath)) {
  const lines = fs.readFileSync(integrationEnvPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "e2e-report" }],
  ],
  use: {
    baseURL: process.env.VITE_APP_URL ?? "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // Mocked tests — run without a live node, inject tokens per-test.
    {
      name: "mocked",
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
      },
      testMatch: [
        "**/landing.spec.ts",
        "**/workspace.spec.ts",
        "**/auth.spec.ts",
      ],
    },
    // Integration tests — full-stack against real merod nodes.
    // Reads credentials from app/.env.integration (written by setup-nodes.sh).
    // Gracefully skips every test if the env file is absent.
    {
      name: "integration",
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
        actionTimeout: 15_000,
        navigationTimeout: 30_000,
      },
      timeout: 90_000,
      testMatch: ["**/integration.spec.ts", "**/chat.spec.ts"],
    },
    // Live tests — same browser specs as mocked but with real auth session.
    // landing.spec.ts is excluded: all its tests expect unauthenticated state
    // (h1 heading, ConnectButton) which is incompatible with real tokens in AUTH_FILE.
    {
      name: "live",
      use: {
        ...devices["Desktop Chrome"],
        storageState: AUTH_FILE,
      },
      testMatch: [
        "**/workspace.spec.ts",
        "**/auth.spec.ts",
      ],
    },
    // RPC tests — direct HTTP calls to a live merod node. No browser.
    // Requires app/.env.integration (written by scripts/dev-node.sh).
    // Gracefully skips every test if the env file is absent.
    {
      name: "rpc",
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
      },
      timeout: 60_000,
      testMatch: ["**/rpc.spec.ts"],
    },
    // RPC admin tests — REST admin API calls to a live merod node. No browser.
    {
      name: "rpc-admin",
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
      },
      timeout: 60_000,
      testMatch: ["**/rpc-admin.spec.ts"],
    },
    // SSE subscription tests — direct SSE stream + RPC calls against a live node.
    // Measures subscribe/unsubscribe correctness and event latency.
    // Requires app/.env.integration (written by scripts/dev-node.sh).
    {
      name: "sse",
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
      },
      timeout: 30_000,
      testMatch: ["**/sse.spec.ts"],
    },
  ],
  webServer: process.env.SKIP_DEV_SERVER
    ? undefined
    : {
        command: "pnpm dev",
        url: "http://localhost:5173",
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
      },
});
