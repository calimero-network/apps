/**
 * Thin JSON-RPC client for calling WASM methods directly on the node.
 * No browser involved — just HTTP calls to the node's execute endpoint.
 */

export interface RpcClientOptions {
  nodeUrl: string;
  accessToken: string;
  contextId: string;
  executorPublicKey: string;
}

export interface RpcError {
  type: string;
  data: string;
}

export interface RpcResult<T = unknown> {
  output?: T;
  error?: string;
}

let _idCounter = Math.floor(Math.random() * 1_000_000);
function nextId() { return ++_idCounter; }

// Node encodes WASM error strings as UTF-8 byte arrays inside the error data field:
// "the method call returned an error: [34, 77, ...]"
// Decode the byte array back to the original error string.
function decodeNodeError(data: string): string {
  const match = data.match(/\[(\d+(?:,\s*\d+)*)\]/);
  if (match) {
    try {
      const bytes = JSON.parse(`[${match[1]}]`) as number[];
      const str = new TextDecoder().decode(new Uint8Array(bytes));
      // WASM serialises the string as JSON (with surrounding quotes) — strip them
      return JSON.parse(str) as string;
    } catch { /* fall through */ }
  }
  return data;
}

export class RpcClient {
  constructor(private readonly opts: RpcClientOptions) {}

  /** Execute a WASM method. Returns the output value. Throws on RPC error. */
  async call<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    const payload = {
      jsonrpc: "2.0",
      id: nextId(),
      method: "execute",
      params: {
        contextId:        this.opts.contextId,
        method,
        argsJson:         args,
        executorPublicKey: this.opts.executorPublicKey,
      },
    };

    const res = await fetch(`${this.opts.nodeUrl}/jsonrpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${this.opts.accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    const body = await res.json() as {
      result?: RpcResult<T>;
      error?: RpcError | { message?: string; data?: string };
    };

    if (body.error) {
      const e = body.error;
      const raw = (e as RpcError).data ?? (e as { message?: string }).message ?? JSON.stringify(e);
      throw new RpcCallError(method, decodeNodeError(raw));
    }

    if (body.result?.error) {
      throw new RpcCallError(method, body.result.error);
    }

    const raw = body.result?.output;
    // logic-js WASM wraps every return value in { result: <actual value> }.
    // Unwrap it so callers get the actual value directly.
    if (raw !== null && raw !== undefined && typeof raw === "object" && "result" in (raw as object)) {
      return (raw as { result: T }).result;
    }
    return raw as T;
  }

  /** Same as call() but returns { ok, value, error } instead of throwing. */
  async tryCall<T = unknown>(method: string, args: Record<string, unknown> = {}): Promise<
    { ok: true; value: T } | { ok: false; error: string }
  > {
    try {
      const value = await this.call<T>(method, args);
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class RpcCallError extends Error {
  constructor(public readonly method: string, message: string) {
    super(`${method} → ${message}`);
    this.name = "RpcCallError";
  }
}

// ── Env helpers ──────────────────────────────────────────────────────────────

export interface IntegrationEnv {
  nodeUrl:        string;
  nodeUrl2:       string;
  accessToken:    string;
  refreshToken:   string;
  accessToken2:   string;
  refreshToken2:  string;
  groupId:        string;
  contextGroupId: string;
  contextId:      string;
  memberKey:      string;
  memberKey2:     string;
}

export function getEnv(): IntegrationEnv {
  const groupId = process.env.E2E_GROUP_ID ?? "";
  return {
    nodeUrl:        process.env.E2E_NODE_URL        ?? "",
    nodeUrl2:       process.env.E2E_NODE_URL_2      ?? "",
    accessToken:    process.env.E2E_ACCESS_TOKEN    ?? "",
    refreshToken:   process.env.E2E_REFRESH_TOKEN   ?? "",
    accessToken2:   process.env.E2E_ACCESS_TOKEN_2  ?? "",
    refreshToken2:  process.env.E2E_REFRESH_TOKEN_2 ?? "",
    groupId,
    contextGroupId: process.env.E2E_CONTEXT_GROUP_ID ?? groupId,
    contextId:      process.env.E2E_CONTEXT_ID      ?? "",
    memberKey:      process.env.E2E_MEMBER_KEY      ?? "",
    memberKey2:     process.env.E2E_MEMBER_KEY_2    ?? "",
  };
}

/** True when the single-node minimum env is present. */
export function envAvailable(): boolean {
  const e = getEnv();
  return !!(e.nodeUrl && e.accessToken && e.groupId && e.contextId && e.memberKey);
}

/** True when both nodes are configured for multi-user tests. */
export function twoNodeEnvAvailable(): boolean {
  const e = getEnv();
  return !!(
    e.nodeUrl && e.accessToken && e.contextId && e.memberKey &&
    e.nodeUrl2 && e.accessToken2 && e.memberKey2
  );
}

/** Client for node-1 / Alice. */
export function makeClient(overrides: Partial<RpcClientOptions> = {}): RpcClient {
  const env = getEnv();
  return new RpcClient({
    nodeUrl:           env.nodeUrl,
    accessToken:       env.accessToken,
    contextId:         env.contextId,
    executorPublicKey: env.memberKey,
    ...overrides,
  });
}

/** Client for node-2 / Bob. Targets node-2 URL with node-2 credentials. */
export function makeClient2(overrides: Partial<RpcClientOptions> = {}): RpcClient {
  const env = getEnv();
  return new RpcClient({
    nodeUrl:           env.nodeUrl2,
    accessToken:       env.accessToken2,
    contextId:         env.contextId,
    executorPublicKey: env.memberKey2,
    ...overrides,
  });
}

// ── Admin REST helpers ───────────────────────────────────────────────────────

export async function adminGet<T>(path: string, nodeUrl?: string, token?: string): Promise<T> {
  const env = getEnv();
  const base = nodeUrl ?? env.nodeUrl;
  const auth = token  ?? env.accessToken;
  const res = await fetch(`${base}/admin-api${path}`, {
    headers: { Authorization: `Bearer ${auth}` },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  const body = await res.json() as { data?: T } | T;
  return (body as { data?: T }).data ?? (body as T);
}

export async function adminPost<T>(
  path: string,
  payload?: unknown,
  nodeUrl?: string,
  token?: string,
): Promise<T> {
  const env = getEnv();
  const base = nodeUrl ?? env.nodeUrl;
  const auth = token  ?? env.accessToken;
  const res = await fetch(`${base}/admin-api${path}`, {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload ?? {}),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`POST ${path} → ${res.status}: ${text}`);
  }
  const body = await res.json() as { data?: T } | T;
  return (body as { data?: T }).data ?? (body as T);
}
