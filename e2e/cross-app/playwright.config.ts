// Apps on their own and with Calimero Home over one organization, in Chromium
// on `merod local` (core's development cluster: three nodes on
// 127.0.0.1:2501-2503, mock attestation). Core holds the only state, so what
// Chat, Home and KV Store each show of the org must agree.
//
// Three dev servers, one per app, each on its own origin (origins.ts), all
// against `merod local` (VITE_CALIMERO_TARGET=local) and from the installed
// packages rather than a raw bundle, so Chat makes its app team as it does on
// a cluster. The global setup starts the cluster and installs the packages.
//
// CI: components.yml's `cross-app` job, on merod at the pinned
// `component-core-tag` (1.0.0-rc.14 or later: app teams). By hand:
//
//   MEROD_BIN=/path/to/merod pnpm -F @calimero-apps/cross-app-e2e test:e2e
import { defineConfig, devices } from "@playwright/test";

import { ORIGINS } from "./origins.ts";

/** Vite in `apps/<dir>/app` on `origin`'s port, against merod local, from the installed package. */
function devServer(dir: string, origin: string) {
  const port = new URL(origin).port;
  return {
    command: `pnpm exec vite --port ${port} --strictPort`,
    cwd: `../../apps/${dir}/app`,
    url: `${origin}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      VITE_CALIMERO_TARGET: "local",
      // Empty, so a `.env.development.local` from `pnpm dev:local` (a raw
      // bundle, which no package ships and so has no app team) is overridden.
      VITE_CALIMERO_BUNDLE: "",
    },
  };
}

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  globalSetup: "./global-setup.ts",
  // One cluster, one org: the steps build on each other.
  workers: 1,
  fullyParallel: false,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    // Chromium itself in its new headless mode, not chrome-headless-shell:
    // the shell's renderer crashes on Chat's sign-in dialog over its landing
    // page. `playwright install chromium` installs both.
    channel: "chromium",
    trace: "retain-on-failure",
  },
  webServer: [
    devServer("mero-home", ORIGINS.home),
    devServer("mero-chat", ORIGINS.chat),
    devServer("kv-store", ORIGINS.kv),
  ],
});
