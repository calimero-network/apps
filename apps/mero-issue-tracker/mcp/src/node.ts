/**
 * The cluster side: one `CalimeroClient` per process, the workspace and repo
 * resolution, and the contract's methods by their ABI (camelCase) names.
 */
import { AppError, CalimeroClient, CalimeroError, TrapError } from '@calimero-network/mero-js';

import type { Config } from './config.ts';

/** What the server uses of the client: its generated route methods (a fake in tests). */
export interface Client {
  apps: Pick<CalimeroClient['apps'], 'call' | 'view' | 'list' | 'create'>;
  auth: Pick<CalimeroClient['auth'], 'me'>;
}

export interface ResolvedTarget {
  /** The repo: an app instance id. */
  appId: string;
}

export interface WorkspaceRepo {
  appId: string;
  name: string;
}

/** A client for the configured cluster, acting with the API key. Attests a node before anything is sent. */
export async function connect(cfg: Config): Promise<Client> {
  const t = cfg.target;
  let client: CalimeroClient;
  if (t.kind === 'local') {
    const [baseUrl, ...nodes] = t.nodes;
    client = new CalimeroClient({ baseUrl: baseUrl as string, nodes, policy: { allowMock: true } });
  } else if (t.kind === 'node') {
    // Attested under the release policy, as a cloud node is; reached by URL.
    const [baseUrl, ...nodes] = t.nodes;
    client = new CalimeroClient({
      baseUrl: baseUrl as string,
      nodes,
      policy: { release: { minReleaseVersion: t.minReleaseVersion } },
    });
  } else {
    client = await CalimeroClient.connect({
      cluster: t.cluster,
      policy: { release: { minReleaseVersion: t.minReleaseVersion } },
      ...(t.zone ? { zone: t.zone } : {}),
      ...(t.directory ? { directory: t.directory } : {}),
    });
  }
  client.useApiKey(cfg.apiKey);
  return client;
}

/** The node's refusal as one line an agent can act on. */
export function describe(err: unknown): string {
  if (err instanceof AppError) {
    const fields = Object.keys(err.fields).length ? ` ${JSON.stringify(err.fields)}` : '';
    return `${err.appCode}${fields}`;
  }
  if (err instanceof TrapError) return `the app aborted the call (${err.kind || 'trap'})`;
  if (err instanceof CalimeroError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/** A call: through the app's log. Answers the method's result. */
export async function callMethod<T = unknown>(
  client: Client,
  target: ResolvedTarget,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  return (await client.apps.call({ app: target.appId, method, args })).result as T;
}

/** A view: answered by a node without writing. */
export async function viewMethod<T = unknown>(
  client: Client,
  target: ResolvedTarget,
  method: string,
  args: Record<string, unknown>,
): Promise<T> {
  return (await client.apps.view({ app: target.appId, method, args })).result as T;
}

export async function findWorkspace(client: Client, cfg: Config): Promise<{ orgId: string; name: string }> {
  const wanted = cfg.workspaceRaw;
  if (!wanted) throw new Error('TRACKER_WORKSPACE is not set.');
  const me = (await client.auth.me()) as { orgs?: Array<{ orgId: string; name: string }> };
  const orgs = me.orgs ?? [];
  const match = orgs.find((o) => o.orgId === wanted || o.name === wanted);
  if (!match) {
    const available = orgs.map((o) => o.name || o.orgId).join(', ') || '(none)';
    throw new Error(`Workspace "${wanted}" not found. Available workspaces: ${available}`);
  }
  return match;
}

/** The repos of `org`: instances of this app (its package, or the dev bundle) in that org. */
export async function listWorkspaceRepos(client: Client, cfg: Config, org: string): Promise<WorkspaceRepo[]> {
  const filter = typeof cfg.source === 'string' ? { bundle: cfg.source } : { package: cfg.source.package };
  const { apps } = await client.apps.list(filter);
  return apps
    .filter((a) => a.org === org)
    .map((a) => ({ appId: a.appId, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function pickRepo(repos: WorkspaceRepo[], wanted?: string): WorkspaceRepo {
  if (wanted) {
    const match = repos.find((r) => r.name === wanted);
    if (match) return match;
    const available = repos.map((r) => r.name).join(', ') || '(none)';
    throw new Error(`Repo "${wanted}" not found. Available repos: ${available}`);
  }
  if (repos.length === 1) return repos[0] as WorkspaceRepo;
  if (repos.length === 0) throw new Error('No repos found in this workspace. Add one with add_repo or in the app.');
  const available = repos.map((r) => r.name).join(', ');
  throw new Error(`Multiple repos exist; pass "repo" or set TRACKER_REPO. Available repos: ${available}`);
}

/** Memoised (and retried after a failure) repo listing for the configured workspace. */
export function createRepoLister(cfg: Config, getClient: () => Promise<Client>): () => Promise<WorkspaceRepo[]> {
  let cached: Promise<WorkspaceRepo[]> | null = null;
  return () =>
    (cached ??= (async () => {
      const client = await getClient();
      const org = await findWorkspace(client, cfg);
      return listWorkspaceRepos(client, cfg, org.orgId);
    })().catch((err) => {
      cached = null;
      throw err;
    }));
}

/** The repo a tool call targets: TRACKER_APP, else `repo`, TRACKER_REPO, or the workspace's only repo. */
export function createTargetResolver(
  cfg: Config,
  listRepos: () => Promise<WorkspaceRepo[]>,
): (repoParam?: string) => Promise<ResolvedTarget> {
  if (cfg.appRaw) {
    const pinned = cfg.appRaw;
    return async (repoParam) => {
      if (repoParam) console.error(`[issue-tracker-mcp] repo "${repoParam}" ignored - TRACKER_APP pins one repo.`);
      return { appId: pinned };
    };
  }
  return async (repoParam) => {
    const repo = pickRepo(await listRepos(), repoParam?.trim() || cfg.repoDefault);
    return { appId: repo.appId };
  };
}
