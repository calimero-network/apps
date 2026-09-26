import { existsSync, rmSync } from "node:fs";
import { DATA_DIR, readState } from "./global-setup";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

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
  if (!pids.length) return;
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  // SIGTERM returns before merod has exited, and rocksdb keeps writing into
  // DATA_DIR while it shuts down — deleting straight away raced it and failed
  // a fully green run with `ENOTEMPTY: directory not empty, rmdir …/data`.
  // Wait for the exit (SIGKILL after 10s), then delete with retries.
  const deadline = Date.now() + 10_000;
  while (pids.some(alive) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const pid of pids.filter(alive)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
  try {
    rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    // Cleanup is best-effort: global-setup wipes DATA_DIR before it starts a
    // node, so a leftover directory cannot leak into the next run. Failing
    // the suite here would fail tests that all passed.
    console.warn(`could not remove ${DATA_DIR}:`, e);
  }
}
