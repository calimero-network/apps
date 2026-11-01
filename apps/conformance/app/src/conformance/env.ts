/**
 * Where the matrix runs: clients for a target from `@calimero-apps/connect`
 * (the shared helper every component app connects through), each starting at a
 * different node, and software passkeys for the origin the cluster trusts.
 */
import type { CalimeroClient } from "@calimero-network/mero-js";
import { createClient, type Target } from "@calimero-apps/connect";

import { SoftPasskey } from "./soft-passkey";

/** `target` with its node list rotated to start at node `i`, so two accounts talk to different nodes. */
export function startingAt(target: Target, i: number): Target {
  const nodes = target.nodes;
  if (!nodes || nodes.length === 0) return target;
  const k = i % nodes.length;
  return { ...target, nodes: [...nodes.slice(k), ...nodes.slice(0, k)] } as Target;
}

/** A client for `target` starting at node `i`, with no session. */
export function clientAt(target: Target, i: number): Promise<CalimeroClient> {
  return createClient(startingAt(target, i));
}

/** A software passkey for `origin` (the relying party is its host name). */
export function softPasskey(origin: string): SoftPasskey {
  return new SoftPasskey(new URL(origin).hostname, origin);
}
