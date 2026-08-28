import axios from "axios";
import { getNodeUrl, clearAllStorage } from "@calimero-network/mero-react";

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

export async function adminGet<T>(path: string): Promise<T> {
  const nodeUrl = nodeBase();
  const accessToken = getJwt();
  const res = await axios.get<RpcResponse<T>>(`${nodeUrl}/admin-api${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return res.data.data ?? (res.data as T);
}

/**
 * List namespaces scoped to a single application. Falls back to the unscoped
 * `/namespaces` endpoint on older merod versions that lack the scoped route.
 */
export async function listNamespaces<T>(applicationId?: string): Promise<T> {
  if (applicationId) {
    try {
      return await adminGet<T>(`/namespaces/for-application/${applicationId}`);
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status !== 404 && status !== 405) throw err;
    }
  }
  return adminGet<T>("/namespaces");
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
