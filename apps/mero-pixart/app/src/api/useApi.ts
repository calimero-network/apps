import { useMemo } from "react";
import {
  classifyError,
  type AdminApiClient,
  type Namespace,
  type NodeIdentity,
} from "@calimero-network/mero-js";
import { setApplicationId, useMero } from "@calimero-network/mero-react";
import { decodeContractError, decodeOutput } from "./output";
import { resolveApplicationId } from "./appId";
import { getCachedBlob, setCachedBlob } from "../utils/blobCache";

// ── The app's one way to talk to Calimero ───────────────────────────────────
//
// Everything used to go through a hand-rolled axios layer that read the node
// JWT out of localStorage and POSTed to `{nodeUrl}/jsonrpc` and
// `{nodeUrl}/admin-api/…`. On a delegated (account) session there is no node
// JWT and no node of ours: writes go through the relay under warrants, reads
// are caller-scoped, and the admin mutations have account forms that the raw
// routes do not. Measured on prod: every call 403'd, and the 401 interceptor
// then wiped the session and bounced to `/` — a login loop.
//
// So the pages ask `useApi()` and never a URL:
//   * contract calls   → `mero.rpc.execute` — the node's JSON-RPC on a node
//                        login, the relay's intents on an account; same code.
//   * admin            → `useMero().admin`, the SESSION-AWARE client (apps#348):
//                        the node's own on a node, the account admin on an
//                        account (founds through the relay, signs invitations
//                        itself, governs as the account). `mero.admin` — the
//                        raw client's — is the relay's node route under the
//                        account's token: the 403s above. Never that one.
//   * blobs            → `admin.uploadBlob` / `admin.getBlob`, ALWAYS with the
//                        context id: the relay refuses an account-scoped blob
//                        request without one (256 KB layer bitmaps round-trip
//                        fine for an account; proven on prod).
//   * identity         → `admin.getNodeIdentity().accountId` — the account,
//                        which is what the contract keys members by and what
//                        the account admin answers with on a relay.
//   * application id   → the provider's registry-resolved id on an account;
//                        asked of the node, matched by package, on a node.

export interface Api {
  /** True on a delegated (account) session — node-only controls hide on it. */
  isDelegated: boolean;
  /** The session-aware admin client (`useMero().admin`), never the raw client's. */
  admin: AdminApiClient;
  /** Execute a contract method in a context and return its decoded output. */
  call<T>(contextId: string, method: string, args?: Record<string, unknown>): Promise<T>;
  /** MeroPixArt's application id for this session, or "" when unknown. */
  ensureAppId(): Promise<string>;
  /** Namespaces (teams) of this app, falling back to the unscoped list on old nodes. */
  listNamespaces(appId: string): Promise<Namespace[]>;
  /** Who this session is: `accountId` is what member listings name members by. */
  getNodeIdentity(): Promise<NodeIdentity>;
  /** Upload a blob announced to `contextId`'s peers. */
  uploadBlob(data: ArrayBuffer | Uint8Array, contextId: string): Promise<{ blobId: string }>;
  /** Read a blob, cached in IndexedDB, probing `contextId`'s peers when we lack it. */
  getBlob(blobId: string, contextId: string): Promise<ArrayBuffer>;
}

const NOT_CONNECTED = "Not connected to Calimero yet.";

/** An admin whose every call rejects, for the instant before the provider connects. */
function notConnectedAdmin(): AdminApiClient {
  return new Proxy({} as AdminApiClient, {
    get: () => () => Promise.reject(new Error(NOT_CONNECTED)),
  });
}

// The node's answer only changes when this app is installed or removed there,
// so it is asked once per node URL per page load rather than per mount — the
// desktop can deep-link straight into the editor, and both list pages need it.
const appIdCache = new Map<string, string>();

/** Test seam: forget the memoised application ids. */
export function clearApplicationIdCache(): void {
  appIdCache.clear();
}

/** The message of whatever the transport threw, with contract aborts decoded. */
function callErrorMessage(err: unknown): string {
  const e = err as { message?: unknown; data?: unknown } | null;
  const data = typeof e?.data === "string" ? e.data : "";
  const message = typeof e?.message === "string" ? e.message : String(err);
  // The node's `{ type, data }` error puts the contract's words in `data`;
  // mero-js keeps both. Prefer the one that carries the byte array.
  return decodeContractError(/\[\s*\d+/.test(data) ? data : message || data);
}

export function useApi(): Api {
  const { mero, admin, isDelegated, applicationId, nodeUrl } = useMero();

  return useMemo<Api>(() => {
    const a = admin ?? notConnectedAdmin();
    const rpc = mero?.rpc ?? null;
    const key = nodeUrl ?? "";

    async function call<T>(
      contextId: string,
      method: string,
      args: Record<string, unknown> = {},
    ): Promise<T> {
      if (!rpc) throw new Error(NOT_CONNECTED);
      let out: unknown;
      try {
        out = await rpc.execute<unknown>({ contextId, method, argsJson: args });
      } catch (err) {
        throw new Error(callErrorMessage(err));
      }
      return decodeOutput<T>(out);
    }

    async function ensureAppId(): Promise<string> {
      if (isDelegated) {
        // Resolved by the provider from the registry for THIS package — not
        // inherited from whichever app last logged in on this origin.
        return applicationId ?? "";
      }
      const cached = appIdCache.get(key);
      if (cached) return cached;
      let id = "";
      if (admin) {
        try { id = await resolveApplicationId(admin); } catch { /* fall back below */ }
      }
      if (!id) id = applicationId ?? "";
      if (id) {
        appIdCache.set(key, id);
        setApplicationId(id);
      }
      return id;
    }

    async function listNamespaces(appId: string): Promise<Namespace[]> {
      if (appId) {
        try {
          const scoped = await a.listNamespacesForApplication(appId);
          return Array.isArray(scoped) ? scoped : [];
        } catch (err) {
          // Older merod versions lack the scoped route.
          const { status } = classifyError(err);
          if (status !== 404 && status !== 405) throw err;
        }
      }
      const all = await a.listNamespaces();
      return Array.isArray(all) ? all : [];
    }

    async function uploadBlob(
      data: ArrayBuffer | Uint8Array,
      contextId: string,
    ): Promise<{ blobId: string }> {
      const res = await a.uploadBlob({ data, contextId });
      return { blobId: res?.blobId ?? "" };
    }

    async function getBlob(blobId: string, contextId: string): Promise<ArrayBuffer> {
      const cached = await getCachedBlob(blobId);
      if (cached) return cached;
      const buf = await a.getBlob(blobId, { contextId });
      setCachedBlob(blobId, buf); // fire-and-forget, non-blocking
      return buf;
    }

    return {
      isDelegated,
      admin: a,
      call,
      ensureAppId,
      listNamespaces,
      getNodeIdentity: () => a.getNodeIdentity(),
      uploadBlob,
      getBlob,
    };
  }, [mero, admin, isDelegated, applicationId, nodeUrl]);
}
