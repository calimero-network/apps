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

/**
 * A contract abort (`app::bail!`) comes back as
 *   `the method call returned an error: [34, 116, 104, …]`
 * — the message as a JSON-encoded UTF-8 byte array. The success path below
 * already decodes byte arrays; without the same treatment here a user is shown
 * a wall of numbers instead of "that member hasn't opened this document yet…".
 * Exported for tests.
 */
export function decodeContractError(msg: string): string {
  const m = /\[((?:\s*\d+\s*,)*\s*\d+\s*)\]/.exec(msg);
  if (!m) return msg;
  const bytes = m[1].split(",").map((n) => Number(n.trim()));
  if (!bytes.length || bytes.some((b) => !Number.isInteger(b) || b < 0 || b > 255)) return msg;
  try {
    const text = new TextDecoder().decode(new Uint8Array(bytes));
    // The message is a JSON string, so it arrives wrapped in quotes (byte 34).
    let decoded = text;
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === "string") decoded = parsed;
    } catch {
      /* not JSON — use the raw decode */
    }
    return decoded.trim() || msg;
  } catch {
    return msg;
  }
}

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
    throw new Error(decodeContractError(msg));
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

/** What `GET /admin-api/identity` answers with. */
export interface NodeIdentity {
  /** The person: 64 hex characters. What member listings name members by. */
  accountId: string;
  /** This installation, when the node reports one. */
  deviceId?: string;
  publicKey?: string;
}

/**
 * Ask the NODE who it is.
 *
 * core 0.11.0-rc.23 (#3522) deleted `GET /namespaces/:id/identity` and dropped
 * `selfIdentity` from the group member listing — "who am I" was always a
 * node-level question, and one identity is shared across namespaces. Compare
 * `accountId` against a member's `identity`, which rc.23 also made an account.
 *
 * Reading `selfIdentity` off the member listing instead does not fail: the
 * field is simply absent, so "am I an admin" silently answers false and every
 * moderation control stays disabled.
 */
export async function getNodeIdentity(): Promise<NodeIdentity> {
  return adminGet<NodeIdentity>("/identity");
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
