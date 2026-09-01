import axios from "axios";
import { getNodeUrl, clearAllStorage } from "@calimero-network/mero-react";
import {
  contextsForThisApp,
  namespacesForThisApp,
  type ContextRecord,
  type NamespaceRecord,
} from "./appScope";

// ── rc.8 data layer ───────────────────────────────────────────────────────────
//
// This is the single foundation every contract/admin call goes through. Mirrors
// mero-pixart's rpc.ts almost verbatim. The big change from the legacy
// calimero-client@1.6.3 stack: there is no JsonRpcClient/WsSubscriptionsClient.
// We talk to the node directly over HTTP with the JWT access token that
// mero-react stores in localStorage["mero-tokens"], and stream live updates
// over SSE (see hooks/useSse.ts) instead of the old `/ws` socket.

interface RpcResponse<T> {
  data: T;
  error?: string;
}

/** Read the access token from the mero token store (localStorage["mero-tokens"]). */
export function getJwt(): string {
  try {
    const raw = localStorage.getItem("mero-tokens");
    return raw ? (JSON.parse(raw).access_token ?? "") : "";
  } catch {
    return "";
  }
}

/** Node URL from mero-react storage (set by the auth callback / Tauri hash). */
function nodeBase(): string {
  return getNodeUrl() ?? "";
}

axios.interceptors.response.use(
  (r) => r,
  (err) => {
    const url: string = err?.config?.url ?? "";
    const is401 = err?.response?.status === 401;
    const isAuthEndpoint = url.includes("/auth/token") || url.includes("/auth/");
    // identities-owned failure is non-fatal — CalendarPage falls back to JWT sub
    const isIdentitiesOwned = url.includes("/identities-owned");
    if (is401 && !isAuthEndpoint && !isIdentitiesOwned) {
      clearAllStorage();
      window.location.href = "/login";
    }
    return Promise.reject(err);
  },
);

/**
 * Execute a contract method on a context. Returns the contract's parsed output.
 * The node wraps the result in { output, logs }; output may be a JSON value,
 * a JSON string, or a legacy u8[] byte array — all three are handled.
 */
export async function rpcCall<T>(
  contextId: string,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  const nodeUrl = nodeBase();
  const accessToken = getJwt();
  const res = await axios.post(
    `${nodeUrl}/jsonrpc`,
    {
      jsonrpc: "2.0",
      id: 1,
      method: "execute",
      params: {
        contextId,
        method,
        argsJson: args,
      },
    },
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );
  const body = res.data;
  if (body.error) {
    const msg =
      typeof body.error === "string"
        ? body.error
        : typeof body.error.data === "string" && body.error.data
          ? body.error.data
          : (body.error.message ?? JSON.stringify(body.error));
    throw new Error(msg);
  }
  const result = body.result;
  if (result?.output !== undefined) {
    const out = result.output;
    if (out === null || out === undefined) return null as T;
    if (typeof out === "string") {
      try {
        return JSON.parse(out) as T;
      } catch {
        return out as T;
      }
    }
    if (Array.isArray(out)) {
      if (out.length === 0) return [] as unknown as T;
      if (typeof out[0] !== "number") return out as T; // already JSON objects
      const text = new TextDecoder().decode(new Uint8Array(out as number[]));
      return JSON.parse(text) as T;
    }
    if (typeof out === "object") return out as T;
    return null as T;
  }
  return result?.data ?? result ?? body.data ?? (null as T);
}

/**
 * Pull a list out of whatever core wrapped it in.
 *
 * `adminGet` already peels one `{data}` envelope, but what is left differs per
 * route: a bare array for namespaces, `{contexts: [...]}` for the context
 * routes. Anything unrecognised becomes an empty list rather than a crash —
 * these lists drive a picker, and a picker with no options is readable while a
 * thrown TypeError blanks the page.
 */
function unwrapList<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    for (const key of ["contexts", "namespaces", "items", "data"]) {
      const val = obj[key];
      if (Array.isArray(val)) return val as T[];
      if (val && typeof val === "object") {
        const nested = unwrapList<T>(val);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

export async function adminGet<T>(path: string): Promise<T> {
  const nodeUrl = nodeBase();
  const accessToken = getJwt();
  const res = await axios.get<RpcResponse<T>>(`${nodeUrl}/admin-api${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data.data ?? (res.data as T);
}

/**
 * List the namespaces that target a single application.
 *
 * Unlike a plain `adminGet("/namespaces")` this never widens to the whole
 * node. Without an application id there is no correct answer, so the answer is
 * an empty list: showing another application's namespaces as Mero Calendar
 * teams dead-ends on an opaque 500 the moment one is opened.
 *
 * Older merod builds lack the scoped route; there the unscoped list is
 * filtered client-side on `targetApplicationId`, the same field core's scoped
 * handler filters on and one it always serializes on both routes.
 */
export async function listNamespaces(
  applicationId?: string,
): Promise<NamespaceRecord[]> {
  const appId = applicationId?.trim();
  if (!appId) return [];

  try {
    const scoped = await adminGet<unknown>(
      `/namespaces/for-application/${appId}`,
    );
    return namespacesForThisApp(unwrapList<NamespaceRecord>(scoped), appId);
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    if (status !== 404 && status !== 405) throw err;
  }

  const all = await adminGet<unknown>("/namespaces");
  return namespacesForThisApp(unwrapList<NamespaceRecord>(all), appId);
}

/**
 * List the contexts running a single application, across every namespace.
 *
 * Same contract as `listNamespaces`: no application id means an empty list.
 * There is no unscoped fallback worth having here — a node-wide context list
 * carries `applicationId` on every entry, so the filter below is exact.
 */
export async function listContextsForApplication(
  applicationId?: string,
): Promise<ContextRecord[]> {
  const appId = applicationId?.trim();
  if (!appId) return [];

  try {
    const scoped = await adminGet<unknown>(
      `/contexts/for-application/${appId}`,
    );
    return contextsForThisApp(unwrapList<ContextRecord>(scoped), appId);
  } catch (err) {
    const status = axios.isAxiosError(err) ? err.response?.status : undefined;
    if (status !== 404 && status !== 405) throw err;
  }

  const all = await adminGet<unknown>("/contexts");
  return contextsForThisApp(unwrapList<ContextRecord>(all), appId);
}

/** List the contexts inside one subgroup. */
export async function listGroupContexts(
  groupId: string,
): Promise<ContextRecord[]> {
  return unwrapList<ContextRecord>(await adminGet<unknown>(
    `/groups/${groupId}/contexts`,
  ));
}

/**
 * Delete a context and its local state.
 *
 * This is local to THIS node: it drops our copy and stops syncing. Peers keep
 * theirs, and an invitation we already handed out still resolves for them.
 */
export async function deleteContext<T>(contextId: string): Promise<T> {
  return adminDelete<T>(`/contexts/${contextId}`);
}

/** Leave a context, keeping it alive for the peers that remain. */
export async function leaveContext<T>(contextId: string): Promise<T> {
  return adminPost<T>(`/contexts/${contextId}/leave`, {});
}

export async function adminPost<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const nodeUrl = nodeBase();
  const accessToken = getJwt();
  const res = await axios.post<RpcResponse<T>>(`${nodeUrl}/admin-api${path}`, body, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data.data ?? (res.data as T);
}

/**
 * Join a context this node is entitled to but hasn't joined yet (e.g. a calendar
 * created on a peer after we joined the team). Idempotent on the node side.
 */
export async function joinContext(
  contextId: string,
): Promise<{ memberPublicKey?: string }> {
  return adminPost<{ memberPublicKey?: string }>(`/contexts/${contextId}/join`, {});
}

export async function adminDelete<T>(path: string): Promise<T> {
  const nodeUrl = nodeBase();
  const accessToken = getJwt();
  const res = await axios.delete<RpcResponse<T>>(`${nodeUrl}/admin-api${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    data: {},
  });
  return res.data.data ?? (res.data as T);
}

export async function adminPut<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const nodeUrl = nodeBase();
  const accessToken = getJwt();
  const res = await axios.put<RpcResponse<T>>(`${nodeUrl}/admin-api${path}`, body, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data.data ?? (res.data as T);
}
