import { rmSync } from "node:fs";

const EXIT_TIMEOUT_MS = 10_000; // SIGKILL after this

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pids: number[], sig: NodeJS.Signals): void {
  for (const pid of pids) {
    try {
      process.kill(pid, sig);
    } catch {
      /* already gone */
    }
  }
}

// SIGTERM returns before merod exits and rocksdb keeps writing into its home
// while it shuts down, so removing the directory straight away races it.
export async function stopNodes(pids: number[]): Promise<void> {
  signal(pids, "SIGTERM");
  const deadline = Date.now() + EXIT_TIMEOUT_MS;
  while (pids.some(alive) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  signal(pids.filter(alive), "SIGKILL");
}

// Best-effort: global-setup wipes the directory before starting a node, so a
// leftover one cannot leak into the next run, and failing here would fail a green suite.
export function removeDataDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    console.warn(`could not remove ${dir}:`, e);
  }
}

export async function stopNodesAndRemove(pids: number[], dir: string): Promise<void> {
  await stopNodes(pids);
  removeDataDir(dir);
}
