/** Server config resolved from env vars. See mcp/README.md for the full list. */
export interface Config {
  nodeUrl: string;
  /**
   * TRACKER_CONTEXT value as given - a context id or an alias, not yet
   * resolved. When set it pins a single context directly and bypasses
   * namespace/repo resolution entirely (backward compat).
   */
  contextRaw?: string;
  /** TRACKER_NAMESPACE value as given - a namespace id or name, not yet resolved. */
  namespaceRaw?: string;
  /** TRACKER_REPO - default repo (context alias) within the namespace. */
  repoDefault?: string;
  authToken?: string;
  /** TRACKER_EXECUTOR override; when unset the executor is resolved via admin API. */
  executorOverride?: string;
  /** TRACKER_SERVICE - the app service name used by add_repo's createContext call. */
  serviceName: string;
}

const DEFAULT_NODE_URL = 'http://localhost:2428';
const DEFAULT_SERVICE_NAME = 'issue-tracker';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const contextRaw = env.TRACKER_CONTEXT?.trim() || undefined;
  const namespaceRaw = env.TRACKER_NAMESPACE?.trim() || undefined;
  if (!contextRaw && !namespaceRaw) {
    throw new Error(
      'Set TRACKER_NAMESPACE (a namespace id or name) or TRACKER_CONTEXT (a context id or alias, direct pin).',
    );
  }
  const nodeUrl = (env.CALIMERO_NODE_URL?.trim() || DEFAULT_NODE_URL).replace(/\/+$/, '');
  return {
    nodeUrl,
    contextRaw,
    namespaceRaw,
    repoDefault: env.TRACKER_REPO?.trim() || undefined,
    authToken: env.CALIMERO_AUTH_TOKEN?.trim() || undefined,
    executorOverride: env.TRACKER_EXECUTOR?.trim() || undefined,
    serviceName: env.TRACKER_SERVICE?.trim() || DEFAULT_SERVICE_NAME,
  };
}
