import type { ExecuteTransport } from "@calimero-network/mero-js";

/**
 * The session the data layer writes through, as `useMero()` describes it.
 *
 * The redux thunks (`store/events/actions.ts`) construct the data source once,
 * at module load, outside any component — so they cannot call `useMero()`.
 * `MeroSessionBridge` (App.tsx) copies the live session here on every change,
 * the same way `setContextId()` already hands the active calendar down.
 *
 * ⚠️ Why the data layer no longer reads `localStorage["mero-tokens"]` and the
 * node URL itself: a delegated (account) session has neither. Its transport is
 * the relay, authenticated by the account's device certificate, and only
 * `mero.rpc` knows how to write through it (warrants) — a hand-rolled axios
 * POST to `/jsonrpc` reached nothing an account could use.
 */
export interface DataSession {
  /** The contract transport: a node's JSON-RPC, or the relay for an account. */
  rpc: ExecuteTransport | null;
  /** True for an account + relay session; false for a node login. */
  isDelegated: boolean;
  /**
   * The team (namespace) the open calendar belongs to. Keys the device-local
   * private store on an account; set by the calendar page along with the
   * active context.
   */
  namespaceId: string;
}

let current: DataSession = { rpc: null, isDelegated: false, namespaceId: "" };

export function bindSession(next: Partial<DataSession>): void {
  current = { ...current, ...next };
}

export function getSession(): DataSession {
  return current;
}

/** Test seam. */
export function resetSession(): void {
  current = { rpc: null, isDelegated: false, namespaceId: "" };
}
