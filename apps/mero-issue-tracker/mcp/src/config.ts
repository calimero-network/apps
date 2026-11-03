/**
 * The MCP server's configuration, from the environment.
 *
 * Calimero 1.0: the server talks to a cluster (the three `merod local` nodes
 * in development, a Calimero Cloud cluster by name in production) through
 * mero-js's `CalimeroClient`, authenticated by an API key acting for your
 * account (create one in the app: Members -> "Agent key"). A workspace is an
 * organization, a repo is an instance of this app in it.
 */

export const LOCAL_NODES = ['http://127.0.0.1:2501', 'http://127.0.0.1:2502', 'http://127.0.0.1:2503'];
export const DEFAULT_PACKAGE = 'com.calimero.mero-issue-tracker';

export type Target =
  | { kind: 'local'; nodes: string[] }
  | { kind: 'cloud'; cluster: string; minReleaseVersion: string; zone?: string; directory?: string }
  /** An attested node the operator runs, reached by its URLs: no directory, the cloud's release policy. */
  | { kind: 'node'; nodes: string[]; minReleaseVersion: string };

export interface Config {
  target: Target;
  /** CALIMERO_API_KEY: an API key acting for your account. */
  apiKey: string;
  /**
   * TRACKER_APP: pins one repo (an app instance id) directly, bypassing
   * workspace/repo resolution; every `repo` param is then ignored.
   */
  appRaw?: string;
  /** TRACKER_WORKSPACE: the workspace (organization) id or name. */
  workspaceRaw?: string;
  /** TRACKER_REPO: the default repo name within the workspace. */
  repoDefault?: string;
  /**
   * Where repos come from: `TRACKER_BUNDLE` (a raw bundle hash, `merod local`
   * only) or the package (`TRACKER_PACKAGE`, default this app's).
   */
  source: string | { package: string };
}

function text(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function nodes(list: string): string[] {
  const out = list
    .split(',')
    .map((u) => u.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  for (const u of out) {
    if (!/^https?:\/\//.test(u)) throw new Error(`CALIMERO_NODES: ${JSON.stringify(u)} is not an http(s) URL`);
  }
  if (out.length === 0) throw new Error('CALIMERO_NODES names no node');
  return out;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const appRaw = text(env.TRACKER_APP);
  const workspaceRaw = text(env.TRACKER_WORKSPACE);
  if (!appRaw && !workspaceRaw) {
    throw new Error('Set TRACKER_WORKSPACE (a workspace id or name) or TRACKER_APP (a repo app id, direct pin).');
  }
  const apiKey = text(env.CALIMERO_API_KEY);
  if (!apiKey) {
    throw new Error('Set CALIMERO_API_KEY: an API key acting for your account (the app: Members -> "Agent key").');
  }

  const kind = text(env.CALIMERO_TARGET) ?? 'local';
  let target: Target;
  if (kind === 'local') {
    target = { kind, nodes: nodes(text(env.CALIMERO_NODES) ?? LOCAL_NODES.join(',')) };
  } else if (kind === 'cloud') {
    const cluster = text(env.CALIMERO_CLUSTER);
    const minReleaseVersion = text(env.CALIMERO_MIN_RELEASE);
    if (!cluster) throw new Error('CALIMERO_TARGET=cloud needs CALIMERO_CLUSTER (the cluster name).');
    if (!minReleaseVersion) {
      throw new Error('CALIMERO_TARGET=cloud needs CALIMERO_MIN_RELEASE (the lowest mero-tee release a node may run).');
    }
    const zone = text(env.CALIMERO_ZONE);
    const directory = text(env.CALIMERO_DIRECTORY);
    target = { kind, cluster, minReleaseVersion, ...(zone ? { zone } : {}), ...(directory ? { directory } : {}) };
  } else if (kind === 'node') {
    const list = text(env.CALIMERO_NODES);
    const minReleaseVersion = text(env.CALIMERO_MIN_RELEASE);
    if (!list) throw new Error('CALIMERO_TARGET=node needs CALIMERO_NODES (the node URLs).');
    if (!minReleaseVersion) {
      throw new Error('CALIMERO_TARGET=node needs CALIMERO_MIN_RELEASE (the lowest mero-tee release a node may run).');
    }
    target = { kind, nodes: nodes(list), minReleaseVersion };
  } else {
    throw new Error(`CALIMERO_TARGET is ${JSON.stringify(kind)}; use "local", "cloud" or "node".`);
  }

  const bundle = text(env.TRACKER_BUNDLE);
  return {
    target,
    apiKey,
    appRaw,
    workspaceRaw,
    repoDefault: text(env.TRACKER_REPO),
    source: bundle ?? { package: text(env.TRACKER_PACKAGE) ?? DEFAULT_PACKAGE },
  };
}
