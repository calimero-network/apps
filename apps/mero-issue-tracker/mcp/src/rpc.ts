import type { Config } from './config.ts';

/** Error surfaced by a failed node JSON-RPC call (transport or app-level). */
export class RpcError extends Error {
  code?: number;
  data?: unknown;

  constructor(message: string, code?: number, data?: unknown) {
    super(message);
    this.name = 'RpcError';
    this.code = code;
    this.data = data;
  }
}

export interface ResolvedTarget {
  contextId: string;
  executorPublicKey: string;
}

function headers(cfg: Config): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.authToken) h.Authorization = `Bearer ${cfg.authToken}`;
  return h;
}

/**
 * Resolves TRACKER_CONTEXT to a context id. Tries the alias registry first;
 * any failure (not found, bad auth, network) falls back to treating the
 * configured value as a raw context id, per the brief's contract.
 */
export async function resolveContextId(cfg: Config): Promise<string> {
  try {
    const res = await fetch(
      `${cfg.nodeUrl}/admin-api/alias/lookup/context/${encodeURIComponent(cfg.contextRaw)}`,
      { method: 'POST', headers: headers(cfg), body: '{}' },
    );
    if (res.ok) {
      const json = (await res.json()) as { data?: { value?: string } };
      if (json?.data?.value) return json.data.value;
    }
  } catch {
    // network error — fall through to the raw value below
  }
  return cfg.contextRaw;
}

/** Resolves the executor identity: TRACKER_EXECUTOR if set, else the node's first owned identity for the context. */
export async function resolveExecutor(cfg: Config, contextId: string): Promise<string> {
  if (cfg.executorOverride) return cfg.executorOverride;

  const res = await fetch(
    `${cfg.nodeUrl}/admin-api/contexts/${encodeURIComponent(contextId)}/identities-owned`,
    { method: 'GET', headers: headers(cfg) },
  );
  if (!res.ok) {
    throw new Error(`Failed to resolve executor identity: admin API returned ${res.status}`);
  }
  const json = (await res.json()) as { data?: { identities?: string[] } };
  const identities = json?.data?.identities ?? [];
  if (identities.length === 0) {
    throw new Error(`No owned identity found for context ${contextId}. Set TRACKER_EXECUTOR to override.`);
  }
  return identities[0];
}

/** Resolves both the context id and executor identity for a call. Not cached — callers memoize per process. */
export async function resolveTarget(cfg: Config): Promise<ResolvedTarget> {
  const contextId = await resolveContextId(cfg);
  const executorPublicKey = await resolveExecutor(cfg, contextId);
  return { contextId, executorPublicKey };
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: { output?: unknown; [key: string]: unknown };
  error?: { code?: number; message?: string; type?: string; data?: unknown };
}

/** Calls an app method on the node's /jsonrpc endpoint, mirroring the generated client's envelope. */
export async function callMethod<T = unknown>(
  cfg: Config,
  target: ResolvedTarget,
  method: string,
  argsJson: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${cfg.nodeUrl}/jsonrpc`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'execute',
      params: {
        contextId: target.contextId,
        method,
        argsJson,
        executorPublicKey: target.executorPublicKey,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new RpcError(`jsonrpc HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  const body = (await res.json()) as JsonRpcResponse;
  if (body.error) {
    throw new RpcError(body.error.message ?? body.error.type ?? 'RPC error', body.error.code, body.error.data);
  }
  const result = body.result;
  return (result && 'output' in result ? result.output : result) as T;
}
