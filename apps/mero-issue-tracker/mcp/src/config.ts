/** Server config resolved from env vars. See mcp/README.md for the full list. */
export interface Config {
  nodeUrl: string;
  /** TRACKER_CONTEXT value as given — a context id or an alias, not yet resolved. */
  contextRaw: string;
  authToken?: string;
  /** TRACKER_EXECUTOR override; when unset the executor is resolved via admin API. */
  executorOverride?: string;
}

const DEFAULT_NODE_URL = 'http://localhost:2428';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const contextRaw = env.TRACKER_CONTEXT?.trim();
  if (!contextRaw) {
    throw new Error('TRACKER_CONTEXT env var is required (a context id or alias).');
  }
  const nodeUrl = (env.CALIMERO_NODE_URL?.trim() || DEFAULT_NODE_URL).replace(/\/+$/, '');
  return {
    nodeUrl,
    contextRaw,
    authToken: env.CALIMERO_AUTH_TOKEN?.trim() || undefined,
    executorOverride: env.TRACKER_EXECUTOR?.trim() || undefined,
  };
}
