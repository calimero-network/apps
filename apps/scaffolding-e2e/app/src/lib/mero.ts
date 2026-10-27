// ── Mero SDK accessors ───────────────────────────────────────────────────────
//
// One place for "where is the node", "who am I", and "which context" — built on
// `@calimero-network/mero-react`, the SDK every other mero app uses.
//
// This app used to depend on `@calimero-network/calimero-client`, which is the
// previous generation of the same SDK. The names moved as well as the package:
//
//   getAppEndpointKey     → getNodeUrl
//   getExecutorPublicKey  → getContextIdentity
//   CalimeroProvider      → MeroProvider
//   useCalimero           → useMero
//   login({type, url})    → connectToNode(url)
//
// The new vocabulary is used throughout, so this file reads like the equivalent
// module in mero-pixart or mero-design rather than like a translation layer.

import { CloudMero, readSession } from "@calimero-apps/cloud";
import {
  clearAllStorage,
  DEFAULT_LOCAL_NODE_PORTS,
  discoverLocalNodes,
  getContextId,
  getContextIdentity,
  getNodeUrl,
  localNodeUrl,
  nodeEndpoint,
  probeNodeHealth,
  setContextId,
  setContextIdentity,
  setNodeUrl,
} from "@calimero-apps/cloud";

export {
  clearAllStorage,
  getContextId,
  getContextIdentity,
  getNodeUrl,
  setContextId,
  setContextIdentity,
  setNodeUrl,
};

// ── Node discovery ───────────────────────────────────────────────────────────
//
// These come from the SDK; this app used to ask the user to type a node URL and
// pre-filled it with a hardcoded `http://localhost:2528`. That was never
// necessary — mero-js has shipped port discovery the whole time mero-react has
// re-exported it, and a hand-typed URL is one transposed digit away from an
// "unreachable node" that is really a typo.
//
//   DEFAULT_LOCAL_NODE_PORTS  [2428, 2429, 2528, 2529] — both dev-stack nodes
//   discoverLocalNodes()      probes those in parallel, returns healthy bases
//   probeNodeHealth(url)      one base; resolves false rather than throwing
//   localNodeUrl(port)        the canonical base URL for a local port
//   nodeEndpoint(base, path)  join that survives a base carrying a path prefix
export {
  DEFAULT_LOCAL_NODE_PORTS,
  discoverLocalNodes,
  localNodeUrl,
  nodeEndpoint,
  probeNodeHealth,
};

/**
 * The session token for cluster calls, or "" when signed out: the one the
 * provider signed in with (passkeys on Calimero Cloud; there is no v1 token
 * bundle in storage to read).
 */
export function getAccessToken(): string {
  return readSession()?.sessionToken ?? "";
}

// ── The node client ──────────────────────────────────────────────────────────
//
// `api/rpc.ts`, `api/adminApi.ts` and `utils/blobUtils.ts` share one client
// for the selected cluster: its `rpc` for contract calls, its `admin` for
// organizations, teams, app instances and blobs. On Calimero Cloud every request
// is sealed to an attested node, so there is no raw node HTTP to build here.
//
// Why a module-level instance and not `useMero()`: these modules are plain
// functions (`kvStore.ts` alone exports dozens), called from sections, the
// Setup Wizard and the Test Runner, not hooks. The instance is keyed by node
// URL AND session token, so a client built before login is replaced by a
// signed-in one on the next call.

/**
 * Per-request budget for every node call.
 *
 * Set by the slowest legitimate request, a blob read: core's blob discovery
 * sweep runs to a **30 s deadline before the transfer starts** (probe-based
 * discovery, rc.39 / core#3831). The SDK's 10 s default would cancel a fetch
 * that was about to succeed and report it as a failure — in precisely the case
 * discovery exists for, a blob held by a peer and not by us. No budget at all
 * is not the answer either; a stalled node should fail, just not before core
 * has finished looking.
 */
export const NODE_REQUEST_TIMEOUT_MS = 35_000;

let cached: { key: string; client: CloudMero } | null = null;

/**
 * The client for the selected cluster, or null when none is selected.
 *
 * Shares `MeroProvider`'s session, so it is signed in exactly when the
 * provider is.
 */
export function getMeroClient(): CloudMero | null {
  const nodeUrl = getNodeUrl();
  if (!nodeUrl) return null;
  const key = `${nodeUrl}\u0000${getAccessToken()}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      client: new CloudMero(nodeUrl),
    };
  }
  return cached.client;
}

/** Test seam: forget the memoised client. */
export function resetMeroClient(): void {
  cached = null;
}

/** Forget the current context selection (not the tokens). */
export function clearContextId(): void {
  setContextId("");
}
