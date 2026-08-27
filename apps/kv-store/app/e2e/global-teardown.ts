import { existsSync, rmSync } from "node:fs";
import { DATA_DIR, readState } from "./global-setup";

export default async function globalTeardown() {
  if (!existsSync(DATA_DIR)) return;
  let pids: number[] = [];
  try {
    pids = readState().pids;
  } catch {
    /* no state file — nothing this run spawned */
  }
  // Only what this run started. A reused node (empty pids) is left alone, so
  // local iteration does not pay the node startup cost on every invocation.
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  if (pids.length) rmSync(DATA_DIR, { recursive: true, force: true });
}
