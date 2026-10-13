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

/** A folder (an aliased context) inside a namespace. */
export interface NamespaceFolder {
  contextId: string;
  /** The context alias - the folder's name. */
  name: string;
}

function headers(cfg: Config): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.authToken) h.Authorization = `Bearer ${cfg.authToken}`;
  return h;
}

/**
 * Resolves BOARD_CONTEXT to a context id. Tries the alias registry first;
 * any failure (not found, bad auth, network) falls back to treating the
 * configured value as a raw context id, per the brief's contract.
 */
export async function resolveContextId(cfg: Config): Promise<string> {
  const contextRaw = cfg.contextRaw;
  if (!contextRaw) {
    throw new Error('BOARD_CONTEXT is not set.');
  }
  try {
    const res = await fetch(
      `${cfg.nodeUrl}/admin-api/alias/lookup/context/${encodeURIComponent(contextRaw)}`,
      { method: 'POST', headers: headers(cfg), body: '{}' },
    );
    if (res.ok) {
      const json = (await res.json()) as { data?: { value?: string } };
      if (json?.data?.value) return json.data.value;
    } else {
      // stderr only - stdout is reserved for the MCP protocol stream.
      console.error(
        `[board-mcp] alias lookup for "${contextRaw}" returned ${res.status}; treating it as a raw context id.`,
      );
    }
  } catch (err) {
    console.error(
      `[board-mcp] alias lookup for "${contextRaw}" failed (${err instanceof Error ? err.message : String(err)}); treating it as a raw context id.`,
    );
  }
  return contextRaw;
}

interface NamespaceRecord {
  namespaceId: string;
  name?: string;
  targetApplicationId?: string;
}

/** Shared lookup behind resolveNamespaceId/resolveNamespaceApp - one list fetch, one match rule. */
async function findNamespace(cfg: Config): Promise<NamespaceRecord> {
  const namespaceRaw = cfg.namespaceRaw;
  if (!namespaceRaw) {
    throw new Error('BOARD_NAMESPACE is not set.');
  }
  const res = await fetch(`${cfg.nodeUrl}/admin-api/namespaces`, { headers: headers(cfg) });
  if (!res.ok) {
    throw new Error(`Failed to list namespaces: admin API returned ${res.status}`);
  }
  const json = (await res.json()) as { data?: NamespaceRecord[] };
  const namespaces = json?.data ?? [];
  const match = namespaces.find((n) => n.namespaceId === namespaceRaw || n.name === namespaceRaw);
  if (!match) {
    const available = namespaces.map((n) => n.name ?? n.namespaceId).join(', ') || '(none)';
    throw new Error(`Namespace "${namespaceRaw}" not found. Available namespaces: ${available}`);
  }
  return match;
}

/** Resolves BOARD_NAMESPACE (a namespace id or name) to a namespace id via the admin API's namespace list. */
export async function resolveNamespaceId(cfg: Config): Promise<string> {
  return (await findNamespace(cfg)).namespaceId;
}

/** Resolves BOARD_NAMESPACE to both its id and the application it targets, for add_folder's createContext call. */
export async function resolveNamespaceApp(cfg: Config): Promise<{ namespaceId: string; applicationId: string }> {
  const match = await findNamespace(cfg);
  if (!match.targetApplicationId) {
    throw new Error(`Namespace "${cfg.namespaceRaw}" has no targetApplicationId.`);
  }
  return { namespaceId: match.namespaceId, applicationId: match.targetApplicationId };
}

/**
 * The alias-list envelope has two shapes in the wild: mero-js's .d.ts type
 * wraps entries as {data: {aliases: [{name, value}]}}, but the real node
 * returns a flat map ({data: {aliasName: contextId, ...}}). Accept both.
 */
export function parseAliasEntries(json: unknown): Array<{ name: string; value: string }> {
  const data = (json as { data?: unknown } | undefined)?.data;
  if (data && typeof data === 'object' && Array.isArray((data as { aliases?: unknown }).aliases)) {
    return (data as { aliases: Array<{ name: string; value: string }> }).aliases;
  }
  if (data && typeof data === 'object') {
    return Object.entries(data as Record<string, string>).map(([name, value]) => ({ name, value }));
  }
  return [];
}

/** Lists the folders (aliased contexts) inside a namespace: each context's id plus its folder name. */
export async function listNamespaceFolders(cfg: Config, namespaceId: string): Promise<NamespaceFolder[]> {
  const [contextsRes, aliasesRes] = await Promise.all([
    fetch(`${cfg.nodeUrl}/admin-api/groups/${encodeURIComponent(namespaceId)}/contexts`, { headers: headers(cfg) }),
    fetch(`${cfg.nodeUrl}/admin-api/alias/list/context`, { headers: headers(cfg) }),
  ]);
  if (!contextsRes.ok) {
    throw new Error(`Failed to list contexts for namespace ${namespaceId}: admin API returned ${contextsRes.status}`);
  }
  if (!aliasesRes.ok) {
    throw new Error(`Failed to list context aliases: admin API returned ${aliasesRes.status}`);
  }
  const contextsJson = (await contextsRes.json()) as { data?: Array<{ contextId: string; name?: string }> };
  const aliasesJson = await aliasesRes.json();
  const contexts = contextsJson?.data ?? [];

  // First alias per context id, for contexts the group-entry has no name for.
  const aliasNameByContextId = new Map<string, string>();
  for (const a of parseAliasEntries(aliasesJson)) {
    if (aliasNameByContextId.has(a.value)) continue;
    aliasNameByContextId.set(a.value, a.name);
  }

  const folders: NamespaceFolder[] = [];
  for (const c of contexts) {
    const name = c.name?.trim() || aliasNameByContextId.get(c.contextId);
    if (name) folders.push({ contextId: c.contextId, name });
  }
  return folders;
}

/**
 * Picks a folder from a namespace's folder list per the resolution order: an
 * explicit `wanted` name (folder param or BOARD_FOLDER), else the namespace's
 * only folder, else a helpful error listing what's available.
 */
export function pickFolder(folders: NamespaceFolder[], wanted?: string): NamespaceFolder {
  if (wanted) {
    const match = folders.find((r) => r.name === wanted);
    if (match) return match;
    const available = folders.map((r) => r.name).join(', ') || '(none)';
    throw new Error(`Folder "${wanted}" not found. Available folders: ${available}`);
  }
  if (folders.length === 1) return folders[0];
  if (folders.length === 0) {
    throw new Error('No folders found in this namespace. Create a context and alias it to use as a folder.');
  }
  const available = folders.map((r) => r.name).join(', ');
  throw new Error(`Multiple folders exist; pass "folder" or set BOARD_FOLDER. Available folders: ${available}`);
}

/** A newly created context, per mero-js's CreateContextResponseData (POST /admin-api/contexts). */
export interface CreatedContext {
  contextId: string;
  memberPublicKey: string;
}

/** Creates a context in a namespace, as the app's workspaceOps does via mero.admin.createContext. */
export async function createContext(
  cfg: Config,
  params: { applicationId: string; groupId: string; serviceName: string; name: string },
): Promise<CreatedContext> {
  const res = await fetch(`${cfg.nodeUrl}/admin-api/contexts`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ ...params, initializationParams: [] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to create context: admin API returned ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { data?: CreatedContext };
  if (!json?.data?.contextId || !json?.data?.memberPublicKey) {
    throw new Error('createContext returned no contextId/memberPublicKey');
  }
  return json.data;
}

/** Aliases a context to a name, as the app's workspaceOps does (best-effort) via mero.admin.createContextAlias. */
export async function createContextAlias(cfg: Config, alias: string, contextId: string): Promise<void> {
  const res = await fetch(`${cfg.nodeUrl}/admin-api/alias/create/context`, {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ alias, contextId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to create context alias: admin API returned ${res.status}: ${text.slice(0, 300)}`);
  }
}

/** Resolves the executor identity: BOARD_EXECUTOR if set, else the node's first owned identity for the context. */
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
    throw new Error(`No owned identity found for context ${contextId}. Set BOARD_EXECUTOR to override.`);
  }
  return identities[0];
}

/** Resolves both the context id and executor identity for the BOARD_CONTEXT direct pin. Not cached. */
export async function resolveTarget(cfg: Config): Promise<ResolvedTarget> {
  const contextId = await resolveContextId(cfg);
  const executorPublicKey = await resolveExecutor(cfg, contextId);
  return { contextId, executorPublicKey };
}

/**
 * Returns a resolver that caches namespace + folder-list lookups for the process
 * lifetime, but only on success - a rejected promise must not stick, or one
 * transient startup failure (node not up yet, network blip) bricks every
 * later call.
 */
export function createFolderLister(cfg: Config): () => Promise<NamespaceFolder[]> {
  let namespaceCached: Promise<string> | null = null;
  const resolveNamespace = () =>
    (namespaceCached ??= resolveNamespaceId(cfg).catch((err) => {
      namespaceCached = null;
      throw err;
    }));

  let foldersCached: Promise<NamespaceFolder[]> | null = null;
  return () =>
    (foldersCached ??= resolveNamespace()
      .then((namespaceId) => listNamespaceFolders(cfg, namespaceId))
      .catch((err) => {
        foldersCached = null;
        throw err;
      }));
}

/**
 * Returns a per-call target resolver. When BOARD_CONTEXT is set it pins a
 * single context directly (folder param ignored). Otherwise it
 * resolves `folderParam` against the BOARD_NAMESPACE's folders, per pickFolder's
 * order. Caches per resolved folder name for the process lifetime, only on
 * success (see createFolderLister).
 */
export function createTargetResolver(cfg: Config): (folderParam?: string) => Promise<ResolvedTarget> {
  if (cfg.contextRaw) {
    let cached: Promise<ResolvedTarget> | null = null;
    return (folderParam) => {
      if (folderParam) {
        // stderr only - stdout is reserved for the MCP protocol stream.
        console.error(
          `[board-mcp] folder "${folderParam}" ignored - BOARD_CONTEXT pins a single context directly.`,
        );
      }
      return (cached ??= resolveTarget(cfg).catch((err) => {
        cached = null;
        throw err;
      }));
    };
  }

  const listFolders = createFolderLister(cfg);
  const targetCache = new Map<string, Promise<ResolvedTarget>>();
  return (folderParam) => {
    const key = folderParam ?? '';
    let cached = targetCache.get(key);
    if (!cached) {
      cached = (async () => {
        const folders = await listFolders();
        const folder = pickFolder(folders, folderParam?.trim() || cfg.folderDefault);
        const executorPublicKey = await resolveExecutor(cfg, folder.contextId);
        return { contextId: folder.contextId, executorPublicKey };
      })().catch((err) => {
        targetCache.delete(key);
        throw err;
      });
      targetCache.set(key, cached);
    }
    return cached;
  };
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number;
  result?: { output?: unknown; [key: string]: unknown };
  error?: { code?: number; message?: string; type?: string; data?: unknown };
}

/**
 * A guest (WASM app) error has no top-level `message` - only `type:
 * "FunctionCallError"` plus `data`, a Rust Debug-formatted string like
 * "the method call returned an error: [108, 97, 98, 101, 108, ...]" (the
 * error text's UTF-8 bytes as a decimal array, not JSON). Recover the real
 * message so callers see it instead of the opaque "FunctionCallError" type.
 */
export function decodeFunctionCallErrorData(data: unknown): string | undefined {
  if (typeof data !== 'string') return undefined;
  const match = data.match(/\[[\d,\s]+\]/);
  if (!match) return undefined;
  try {
    const bytes: unknown = JSON.parse(match[0]);
    if (!Array.isArray(bytes) || bytes.length === 0 || !bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)) {
      return undefined;
    }
    const text = Buffer.from(bytes as number[]).toString('utf8').trim();
    if (!text) return undefined;
    // The guest serializes its error as a JSON string, so the decoded bytes
    // are themselves JSON-quoted (e.g. `"label must be..."`); unwrap it.
    try {
      const inner: unknown = JSON.parse(text);
      if (typeof inner === 'string' && inner.trim()) return inner.trim();
    } catch {
      /* not JSON-wrapped - use the raw decoded text below */
    }
    return text;
  } catch {
    return undefined;
  }
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
    const decoded = body.error.type === 'FunctionCallError' ? decodeFunctionCallErrorData(body.error.data) : undefined;
    throw new RpcError(decoded ?? body.error.message ?? body.error.type ?? 'RPC error', body.error.code, body.error.data);
  }
  const result = body.result;
  return (result && 'output' in result ? result.output : result) as T;
}
