import { rmSync } from "node:fs";
import { DATA_DIR, readState } from "./global-setup";

export default async function globalTeardown() {
  let pids: number[] = [];
  try {
    pids = readState().pids;
  } catch {
    /* no state file — nothing this run spawned */
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  // Keep the node log on failure in CI (it is uploaded); locally, clean up.
  if (pids.length && !process.env["CI"]) rmSync(DATA_DIR, { recursive: true, force: true });
}
