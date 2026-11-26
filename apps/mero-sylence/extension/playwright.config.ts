// The built extension loaded unpacked in Chromium: `pnpm build && pnpm e2e`.
//
// e2e/flows.spec.ts saves to a real node: a `merod local` already on :2501
// (`pnpm dev:local mero-sylence`), or one it starts when `merod` runs
// (MEROD_BIN, or on the PATH); without either its node-backed steps skip.
// SYLENCE_E2E_MODEL=1 also runs the real speech model (pipeline.spec.ts).
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  reporter: [["list"]],
});
