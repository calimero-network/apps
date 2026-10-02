/**
 * The page's settings, from its URL (the runner opens it with them) and kept
 * for the tab so a reload holds them:
 *
 *   ?cloud=<url>     the cloud an account resolves relays from (the rig's mock)
 *   ?run=node|account  which run a second session's rows belong to
 *   ?session=primary|second
 *
 * The package is fixed: the matrix drives scaffolding-e2e's contract, so the
 * namespace an account founds names that package, as an app's provider would.
 */
import type { Mode } from './conformance/types';

const KEY = 'conformance.config';

export interface Config {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly registryUrl?: string;
  readonly cloudBaseUrl?: string;
  readonly run?: Mode;
  readonly session: 'primary' | 'second';
}

export function readConfig(): Config {
  let stored: Partial<Config> = {};
  try {
    stored = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Partial<Config>;
  } catch {
    stored = {};
  }
  const q = new URLSearchParams(window.location.search);
  const run = q.get('run');
  const session = q.get('session');
  const config: Config = {
    packageName: q.get('package') ?? stored.packageName ?? 'com.calimero.scaffolding-e2e',
    packageVersion: q.get('version') ?? stored.packageVersion ?? '0.0.0',
    ...((q.get('registry') ?? stored.registryUrl) ? { registryUrl: (q.get('registry') ?? stored.registryUrl)! } : {}),
    ...((q.get('cloud') ?? stored.cloudBaseUrl) ? { cloudBaseUrl: (q.get('cloud') ?? stored.cloudBaseUrl)! } : {}),
    ...(run === 'node' || run === 'account' ? { run } : stored.run ? { run: stored.run } : {}),
    session: session === 'second' ? 'second' : session === 'primary' ? 'primary' : (stored.session ?? 'primary'),
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    /* this page view still has it */
  }
  return config;
}
