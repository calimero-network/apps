import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));

export interface JourneyConfigOptions {
  appDir: string;
  packageId: string;
  port?: number;
  webServerCommand?: string;
  use?: PlaywrightTestConfig["use"];
}

export function journeyConfig(opts: JourneyConfigOptions): PlaywrightTestConfig {
  const port = opts.port ?? (Number(process.env["JOURNEY_APP_PORT"]) || 5390);
  const dataDir = process.env["JOURNEY_DATA_DIR"] ?? path.join(opts.appDir, ".journey-data");
  process.env["JOURNEY_DATA_DIR"] = dataDir;
  process.env["JOURNEY_APP_DIR"] = opts.appDir;
  process.env["JOURNEY_PACKAGE_ID"] = opts.packageId;
  process.env["JOURNEY_APP"] ??= path.basename(path.dirname(opts.appDir));
  const ci = !!process.env["CI"];

  return defineConfig({
    testDir: path.join(opts.appDir, "e2e", "journey"),
    testMatch: /.*\.journey\.ts$/,
    outputDir: path.join(opts.appDir, "test-results", "journey"),
    fullyParallel: false,
    workers: 1,
    forbidOnly: ci,
    retries: ci ? 1 : 0,
    timeout: 15 * 60_000,
    expect: { timeout: 20_000 },
    globalSetup: path.join(HERE, "global-setup.ts"),
    globalTeardown: path.join(HERE, "global-teardown.ts"),
    reporter: [
      [ci ? "list" : "line"],
      ["html", { outputFolder: path.join(opts.appDir, "playwright-report", "journey"), open: "never" }],
      [path.join(HERE, "reporter.ts")],
    ],
    use: {
      baseURL: `http://localhost:${port}`,
      trace: "retain-on-failure",
      video: "retain-on-failure",
      screenshot: "only-on-failure",
      actionTimeout: 15_000,
      navigationTimeout: 30_000,
      ...devices["Desktop Chrome"],
      ...opts.use,
    },
    webServer: {
      command:
        opts.webServerCommand ??
        `pnpm exec vite build && pnpm exec vite preview --port ${port} --strictPort`,
      cwd: opts.appDir,
      url: `http://localhost:${port}`,
      reuseExistingServer: !ci,
      timeout: 240_000,
    },
  });
}
