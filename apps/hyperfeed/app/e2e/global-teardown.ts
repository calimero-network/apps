import { stopNodes, removeDataDir } from "@calimero-apps/e2e-node";
import { DATA_DIR, readState } from "./global-setup";

export default async function globalTeardown() {
  let pids: number[] = [];
  try {
    pids = readState().pids;
  } catch {
    /* no state file - nothing this run spawned */
  }
  await stopNodes(pids);
  // Keep the node log on failure in CI (it is uploaded); locally, clean up.
  if (pids.length && !process.env["CI"]) removeDataDir(DATA_DIR);
}
