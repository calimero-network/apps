import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * `pnpm test:e2e:ci` — what the CI browser job runs.
 *
 * It used to be `--project=mocked` alone: 32 tests that answer the node from
 * `page.route`, so no request body ever met core's deserializer. The job had
 * already installed merod and downloaded this app's bundle, and no test used
 * them. Namespace create (#210) and channel create (#212) both shipped as 400s
 * under that green.
 *
 * This keeps the mocked project and adds every project that talks to a real
 * node, fed by e2e/real-node/global-setup.ts (native merod, embedded auth, the
 * bundle installed, a workspace with #general). `live` is left out: it replays
 * a saved hosted-login session, which a runner does not have.
 */
const keep = new Set(["mocked", "integration", "rpc", "rpc-admin", "sse"]);

export default defineConfig({
  ...base,
  globalSetup: "./e2e/real-node/global-setup.ts",
  globalTeardown: "./e2e/real-node/global-teardown.ts",
  // One node, shared contract state: parallel workers would race each other.
  workers: 1,
  projects: (base.projects ?? [])
    .filter((p) => keep.has(p.name ?? ""))
    .map((p) =>
      p.name === "integration"
        ? { ...p, testMatch: [...(p.testMatch as string[]), "**/features.spec.ts"] }
        : p,
    ),
});
