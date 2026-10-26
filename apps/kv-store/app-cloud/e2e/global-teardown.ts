import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export default async function globalTeardown() {
  const file = join(tmpdir(), "kv-cloud-e2e.pid");
  try {
    process.kill(Number(readFileSync(file, "utf8")), "SIGKILL");
  } catch {
    // already gone
  }
  rmSync(file, { force: true });
}
