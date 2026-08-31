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

import {
  clearAllStorage,
  DEFAULT_LOCAL_NODE_PORTS,
  discoverLocalNodes,
  getContextId,
  getContextIdentity,
  getNodeUrl,
  LocalStorageTokenStore,
  localNodeUrl,
  nodeEndpoint,
  probeNodeHealth,
  setContextId,
  setContextIdentity,
  setNodeUrl,
} from "@calimero-network/mero-react";

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

/** The same store `MeroProvider` uses, so tokens written here are the ones the
 *  provider reads (and vice versa). */
const tokens = new LocalStorageTokenStore();

/** Bearer token for admin-api / JSON-RPC calls, or "" when signed out. */
export function getAccessToken(): string {
  return tokens.getTokens()?.access_token ?? "";
}

/** Persist a token pair — used by the SSO hash bootstrap before React mounts. */
export function setTokens(accessToken: string, refreshToken: string, expiresIn?: number): void {
  tokens.setTokens({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Date.now() + (expiresIn && expiresIn > 0 ? expiresIn * 1000 : 3600_000),
  });
}

/** Forget the current context selection (not the tokens). */
export function clearContextId(): void {
  setContextId("");
}

// ── JWT ──────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub?: string;
  context_id?: string;
  context_identity?: string;
  executor_public_key?: string;
  /** `{ permissions: [{ context: { id, key } }] }` — the shape the node issues
   *  for a context-scoped client key. */
  permissions?: Array<{ context?: { id?: string; key?: string } } | string>;
  [key: string]: unknown;
}

/**
 * Decode a JWT payload without verifying it.
 *
 * Reading the claims is fine — the node verifies the signature on every call, and
 * a forged token buys nothing here. Base64url has to be handled explicitly
 * (`atob` rejects `-`/`_` and requires padding), which is why this is not a
 * one-liner.
 */
export function decodeJwt(token: string | null | undefined): JwtPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const json = decodeURIComponent(
      atob(padded)
        .split("")
        .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as JwtPayload) : null;
  } catch {
    return null;
  }
}

/** The current access token's payload, or null. */
export function getJwtPayload(): JwtPayload | null {
  return decodeJwt(getAccessToken() || null);
}

/**
 * Seed the context selection from a freshly issued token.
 *
 * `AppMode.MultiContext` means the auth callback returns only tokens, the
 * application id and the node url — context selection is the app's job (the Setup
 * Wizard and Workspace Manager do it). But when the token IS context-scoped, its
 * claims already say which one, and using them saves the user a step.
 *
 * Returns true when a context id was found and stored.
 */
export function applyContextFromJwt(token: string): boolean {
  const payload = decodeJwt(token);
  if (!payload) return false;

  // Preferred: a context-scoped client key lists its context in `permissions`.
  for (const entry of payload.permissions ?? []) {
    if (typeof entry === "string") continue;
    const id = entry.context?.id;
    if (id) {
      setContextId(id);
      if (entry.context?.key) setContextIdentity(entry.context.key);
      return true;
    }
  }

  // Fallback: flat claims, which older nodes issue.
  if (payload.context_id) {
    setContextId(payload.context_id);
    const identity = payload.context_identity ?? payload.executor_public_key;
    if (identity) setContextIdentity(identity);
    return true;
  }
  return false;
}
