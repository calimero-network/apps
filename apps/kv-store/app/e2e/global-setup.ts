import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Start a 3-node release-v2 cluster on :2601-2603 with `merod-v2 local`.
 * MEROD_V2_BINARY overrides the binary (default: a sibling core checkout).
 */
export default async function globalSetup() {
  const binary =
    process.env["MEROD_V2_BINARY"] ?? resolve(here, "../../../../../core/target/debug/merod-v2");
  const dir = mkdtempSync(join(tmpdir(), "kv-cloud-e2e-"));
  const child = spawn(
    binary,
    ["local", "--base-port", "2600", "--dir", join(dir, "cluster"), "--origins", "http://localhost:5173"],
    { stdio: process.env["MEROD_V2_LOGS"] ? "inherit" : "ignore", detached: true },
  );
  writeFileSync(join(tmpdir(), "kv-cloud-e2e.pid"), String(child.pid));
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const r = await fetch("http://127.0.0.1:2601/health");
      const h = (await r.json()) as { systemLeader?: number };
      if (h.systemLeader) break;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`merod-v2 local did not start (${binary})`);
    await new Promise((r) => setTimeout(r, 250));
  }
  // The leader registers the nodes and mints the first session key.
  await new Promise((r) => setTimeout(r, 1500));
}
