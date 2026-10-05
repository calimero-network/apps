import { useMemo } from "react";
import { useMero } from "@calimero-network/mero-react";
import type { AdminApiClient, ExecuteTransport, SseClient } from "@calimero-network/mero-js";

// ── The session's clients, reachable from plain functions ───────────────────
//
// Everything this app says to a node or a relay goes through three clients
// that `useMero()` hands out: `mero.rpc` for contract calls, `admin` for the
// admin API and `mero.events` for the event stream. They are the SESSION's
// clients: on a node login they carry the node's token, on an account (relay)
// session the account's device certificate — `admin` is the account-aware
// client that routes a namespace create or a join as the account can do it,
// where the raw `mero.admin` would be the relay's node route under the wrong
// credential and answer 403.
//
// Most of this app's calls are made from plain functions, not components —
// `rpcCall` is fired from fabric event handlers, the batch helpers, the project
// file importer and the flatten operation — so the hook alone is not enough.
// `ApiBinder` publishes the current clients to this module once, under the
// provider, and `getApi()` reads them back from anywhere. There is exactly one
// session per page, so one binding is the truth.

export interface ApiBinding {
  /** Contract calls: `execute({ contextId, method, argsJson })`. Same on both transports. */
  rpc: ExecuteTransport;
  /** The session-aware admin API (`useMero().admin`), never the raw client's. */
  admin: AdminApiClient;
  /** The session's event stream, or null when the transport has none. */
  events: SseClient | null;
  /** True on an account (relay) session: some node-only controls hide. */
  isDelegated: boolean;
}

let current: ApiBinding | null = null;

/** Publish the clients a page's calls use. `null` on disconnect. */
export function bindApi(binding: ApiBinding | null): void {
  current = binding;
}

/** The bound clients, or a clear error when nothing is connected yet. */
export function getApi(): ApiBinding {
  if (!current) {
    throw new Error("Not connected: no Calimero session is bound yet.");
  }
  return current;
}

/** The binding, when there is one — for callers that can wait for a session. */
export function peekApi(): ApiBinding | null {
  return current;
}

/**
 * The session's clients as a binding, or null until connected.
 *
 * `admin` is `useMero().admin`, not `mero.admin`: the latter typechecks only on
 * a node client and would be the wrong credential on a relay anyway.
 */
export function useApi(): ApiBinding | null {
  const { mero, admin, isDelegated } = useMero();
  return useMemo<ApiBinding | null>(() => {
    if (!mero || !admin) return null;
    let events: SseClient | null = null;
    try {
      events = mero.events;
    } catch {
      events = null;
    }
    return { rpc: mero.rpc, admin, events, isDelegated };
  }, [mero, admin, isDelegated]);
}

