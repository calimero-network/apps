import axios from "axios";
import { getNodeUrl, clearAllStorage } from "@calimero-network/mero-react";
import { getCachedBlob, setCachedBlob } from "../utils/blobCache";

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
    // identities-owned failure is non-fatal — EditorPage falls back to JWT sub
    const isIdentitiesOwned = url.includes("/identities-owned");
    if (is401 && !isAuthEndpoint && !isIdentitiesOwned) {
      clearAllStorage();
      window.location.href = "/login";
    }
    return Promise.reject(err);
  },
);

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
    const msg = typeof body.error === "string"
      ? body.error
      : (typeof body.error.data === "string" && body.error.data
          ? body.error.data
          : (body.error.message ?? JSON.stringify(body.error)));
    throw new Error(msg);
  }
  const result = body.result;
  // Calimero execute returns { output: <varies>, logs: [] }.
  // Older nodes: output is u8[] (byte array). Newer nodes: output is already
  // parsed JSON (string, object, or array of objects). Handle both.
  if (result?.output !== undefined) {
    const out = result.output;
    if (out === null || out === undefined) return null as T;
    if (typeof out === "string") {
      try { return JSON.parse(out) as T; } catch { return out as T; }
    }
    if (Array.isArray(out)) {
      if (out.length === 0) return null as T;
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
 * Join a context this node is entitled to but hasn't joined yet (e.g. a project
 * created on a peer after we joined the team). Idempotent on the node side.
 */
export async function joinContext(contextId: string): Promise<{ memberPublicKey?: string }> {
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

export async function adminUploadBlob(data: ArrayBuffer, contextId?: string): Promise<{ blobId: string }> {
  const nodeUrl = nodeBase();
  const accessToken = getJwt();
  // Pass context_id so the node announces the blob to the network immediately.
  const url = contextId
    ? `${nodeUrl}/admin-api/blobs?context_id=${encodeURIComponent(contextId)}`
    : `${nodeUrl}/admin-api/blobs`;
  const res = await axios.put<unknown>(url, data, {
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/octet-stream" },
  });
  const body = res.data as { data?: { blob_id?: string; blobId?: string } };
  const blobId = body?.data?.blob_id ?? body?.data?.blobId ?? "";
  return { blobId };
}

export async function adminGetBlob(blobId: string, contextId?: string): Promise<ArrayBuffer> {
  const cached = await getCachedBlob(blobId);
  if (cached) return cached;

  const nodeUrl = nodeBase();
  const accessToken = getJwt();
  // Pass context_id so the node does P2P network discovery for blobs it doesn't
  // have locally (e.g. an image uploaded by a peer).
  const url = contextId
    ? `${nodeUrl}/admin-api/blobs/${blobId}?context_id=${encodeURIComponent(contextId)}`
    : `${nodeUrl}/admin-api/blobs/${blobId}`;
  const res = await axios.get<ArrayBuffer>(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    responseType: "arraybuffer",
  });
  setCachedBlob(blobId, res.data); // fire-and-forget, non-blocking
  return res.data;
}
