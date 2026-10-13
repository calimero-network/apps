/** Server config resolved from env vars. See mcp/README.md for the full list. */
export interface Config {
  nodeUrl: string;
  /**
   * BOARD_CONTEXT value as given - a context id or an alias, not yet
   * resolved. When set it pins a single context directly and bypasses
   * namespace/folder resolution entirely.
   */
  contextRaw?: string;
  /** BOARD_NAMESPACE value as given - a namespace id or name, not yet resolved. */
  namespaceRaw?: string;
  /** BOARD_FOLDER - default folder (context alias) within the namespace. */
  folderDefault?: string;
  authToken?: string;
  /** BOARD_EXECUTOR override; when unset the executor is resolved via admin API. */
  executorOverride?: string;
  /** BOARD_SERVICE - the app service name used by add_folder's createContext call. */
  serviceName: string;
}

const DEFAULT_NODE_URL = 'http://localhost:2428';
const DEFAULT_SERVICE_NAME = 'board';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const contextRaw = env.BOARD_CONTEXT?.trim() || undefined;
  const namespaceRaw = env.BOARD_NAMESPACE?.trim() || undefined;
  if (!contextRaw && !namespaceRaw) {
    throw new Error(
      'Set BOARD_NAMESPACE (a namespace id or name) or BOARD_CONTEXT (a context id or alias, direct pin).',
    );
  }
  const nodeUrl = (env.CALIMERO_NODE_URL?.trim() || DEFAULT_NODE_URL).replace(/\/+$/, '');
  return {
    nodeUrl,
    contextRaw,
    namespaceRaw,
    folderDefault: env.BOARD_FOLDER?.trim() || undefined,
    authToken: env.CALIMERO_AUTH_TOKEN?.trim() || undefined,
    executorOverride: env.BOARD_EXECUTOR?.trim() || undefined,
    serviceName: env.BOARD_SERVICE?.trim() || DEFAULT_SERVICE_NAME,
  };
}
