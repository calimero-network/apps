/**
 * Thin HTTP client for the Calimero node admin API.
 * Used in integration tests to set up test data and verify backend state
 * without going through the frontend UI.
 */

import type { Page } from "@playwright/test";

export interface NodeClientOptions {
  nodeUrl: string;
  accessToken: string;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
}

export interface Group {
  groupId: string;
  alias?: string;
  targetApplicationId: string;
}

export interface ContextEntry {
  contextId: string;
  applicationId: string;
}

export interface RpcResult {
  output?: unknown;
  error?: string;
}

/**
 * Bootstrap JWT tokens directly from a merod node's embedded auth endpoint.
 * Bypasses the auth-frontend completely — works on any node started with
 * `--auth-mode embedded`.
 */
export async function getNodeTokens(
  nodeUrl: string,
  username: string,
  password: string,
): Promise<AuthTokens> {
  const res = await fetch(`${nodeUrl}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_method: "user_password",
      public_key: username,
      client_name: "playwright-integration",
      timestamp: 0,
      permissions: [],
      provider_data: { username, password },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${res.status}): ${text}`);
  }

  const body = await res.json() as { data?: AuthTokens };
  const tokens = body.data;
  if (!tokens?.access_token) {
    throw new Error(`Auth response missing access_token: ${JSON.stringify(body)}`);
  }
  return tokens;
}

export class NodeClient {
  constructor(private readonly opts: NodeClientOptions) {}

  private get headers() {
    return {
      Authorization: `Bearer ${this.opts.accessToken}`,
      "Content-Type": "application/json",
    };
  }

  private async get<T>(path: string): Promise<T> {
    const res = await fetch(`${this.opts.nodeUrl}/admin-api${path}`, {
      headers: this.headers,
    });
    if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
    const body = await res.json() as { data?: T } | T;
    return (body as { data?: T }).data ?? (body as T);
  }

  private async post<T>(path: string, payload?: unknown): Promise<T> {
    const res = await fetch(`${this.opts.nodeUrl}/admin-api${path}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(payload ?? {}),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST ${path} → ${res.status}: ${text}`);
    }
    const body = await res.json() as { data?: T } | T;
    return (body as { data?: T }).data ?? (body as T);
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(`${this.opts.nodeUrl}/admin-api/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  async listGroups(): Promise<Group[]> {
    const data = await this.get<Group[] | { groups?: Group[]; items?: Group[] }>("/groups");
    if (Array.isArray(data)) return data;
    return (data as { groups?: Group[]; items?: Group[] }).groups
      ?? (data as { items?: Group[] }).items
      ?? [];
  }

  async listContexts(): Promise<ContextEntry[]> {
    const data = await this.get<ContextEntry[] | { contexts?: ContextEntry[]; items?: ContextEntry[] }>("/contexts");
    const raw = Array.isArray(data)
      ? data
      : ((data as { contexts?: ContextEntry[] }).contexts
        ?? (data as { items?: ContextEntry[] }).items
        ?? []);
    // Normalize id → contextId in case the node returns {id} instead of {contextId}
    return raw.map((c) => ({
      ...c,
      contextId: c.contextId ?? (c as unknown as { id?: string }).id ?? "",
    }));
  }

  async getContextIdentities(contextId: string): Promise<string[]> {
    const data = await this.get<string[] | { identities?: string[] }>(
      `/contexts/${contextId}/identities-owned`,
    );
    if (Array.isArray(data)) return data;
    return (data as { identities?: string[] }).identities ?? [];
  }

  /** Make a JSON-RPC call to a context method via the node's /jsonrpc endpoint. */
  async rpcCall(
    contextId: string,
    executorPublicKey: string,
    method: string,
    args: Record<string, unknown> = {},
  ): Promise<RpcResult> {
    const payload = {
      jsonrpc: "2.0",
      id: Math.floor(Math.random() * 1_000_000),
      method: "execute",
      params: {
        contextId,
        method,
        argsJson: args,
        executorPublicKey,
      },
    };
    const res = await fetch(`${this.opts.nodeUrl}/jsonrpc`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST /jsonrpc → ${res.status}: ${text}`);
    }
    const body = await res.json() as { result?: RpcResult; error?: unknown };
    if (body.error) throw new Error(JSON.stringify(body.error));
    return body.result ?? {};
  }
}

/**
 * Read the integration env-file values written by scripts/setup-nodes.sh.
 * Falls back to undefined if the env var is not set, so callers can skip
 * integration tests cleanly when no real node is available.
 */
export function getIntegrationEnv() {
  return {
    nodeUrl:        process.env.E2E_NODE_URL       ?? "",
    nodeUrl2:       process.env.E2E_NODE_URL_2     ?? "",
    accessToken:    process.env.E2E_ACCESS_TOKEN   ?? "",
    refreshToken:   process.env.E2E_REFRESH_TOKEN  ?? "",
    accessToken2:   process.env.E2E_ACCESS_TOKEN_2 ?? "",
    refreshToken2:  process.env.E2E_REFRESH_TOKEN_2 ?? "",
    groupId:        process.env.E2E_GROUP_ID       ?? "",
    contextId:      process.env.E2E_CONTEXT_ID     ?? "",
    memberKey:      process.env.E2E_MEMBER_KEY     ?? "",
  };
}

/** Returns true only when all required integration env vars are present. */
export function integrationEnvAvailable(): boolean {
  const e = getIntegrationEnv();
  return !!(e.nodeUrl && e.accessToken && e.groupId && e.contextId);
}

/**
 * Inject real node tokens into the browser's localStorage so mero-react
 * authenticates against the live node without going through auth-frontend.
 */
export async function injectRealTokens(
  page: Page,
  opts: {
    nodeUrl: string;
    accessToken: string;
    refreshToken: string;
  },
) {
  await page.addInitScript(
    ({ nodeUrl, accessToken, refreshToken }) => {
      // MeroProvider internally uses mero-js's `LocalStorageTokenStore()`
      // which reads/writes a single JSON blob at `mero-tokens`.
      localStorage.setItem("mero:node_url", nodeUrl);
      localStorage.setItem(
        "mero-tokens",
        JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken,
          expires_at: Date.now() + 3600_000,
        }),
      );
    },
    opts,
  );
}

