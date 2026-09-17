import type { MeroJs } from '@calimero-network/mero-js';
import { APP_PACKAGE } from '../config';

/**
 * Resolving mero-sheets' OWN application id.
 *
 * This used to be `useMero().applicationId || VITE_APPLICATION_ID`. Both of
 * those are properties of how you ARRIVED, not of which app you are:
 *
 *   * `useMero().applicationId` comes out of the session the provider restored.
 *     Two apps served from one origin share a `localStorage`, so opening
 *     mero-sheets on a port another Calimero app had used inherits that app's
 *     session, and with it that app's application id. Every namespace read is
 *     scoped by that id, so the workspace picker then lists the OTHER app's
 *     namespaces — filtering correctly, for the wrong app. (The dev port is
 *     pinned in `vite.config.ts` for the same reason; this is the belt to that
 *     set of braces, and the one that also covers production.)
 *   * `VITE_APPLICATION_ID` is baked at build time and an ApplicationId is
 *     per-install: `hash(package, signer)`. mero-design once shipped a build
 *     pinned to an id no node had, and every namespace create failed with an
 *     opaque 500 that never mentions application ids.
 *
 * The node is the only source that can answer "which installed app is me". So
 * ask it, and match on the bundle's `package` — the same identity the registry
 * and the desktop launcher resolve by, and the one thing that does not change
 * between releases, machines or sessions.
 */

export interface InstalledApp {
  id: string;
  package?: string;
  /** Absent when the stored version is empty or not valid semver. */
  version?: string;
}

/** Compare two `X.Y.Z` strings numerically. Anything unparseable sorts lowest. */
function compareVersions(a: string | undefined, b: string | undefined): number {
  const parse = (v: string | undefined) =>
    (v ?? '').split('.').map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isFinite(n) ? n : -1;
    });
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? -1) - (right[i] ?? -1);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Pick this app's id out of everything installed on the node.
 *
 * Returns "" when this app is not installed, rather than guessing. `apps[0]` —
 * the obvious fallback — is whichever app the node happens to list first, which
 * is the wrong-app bug above with extra steps. An empty id makes the caller say
 * "not installed on this node", which is the truth and is actionable.
 *
 * When several installs share the package (a registry build and a locally
 * dev-signed one, which have DIFFERENT ids because the id is
 * `hash(package, signer)`), prefer the highest version so a freshly published
 * bundle wins over a stale one.
 */
export function pickApplicationId(apps: readonly InstalledApp[]): string {
  const mine = apps.filter((a) => a?.package === APP_PACKAGE && !!a.id);
  if (mine.length === 0) return '';
  // Stable: equal versions keep the node's own ordering rather than swapping
  // between reads, which would move the picker under the user.
  const best = mine.reduce((winner, candidate) =>
    compareVersions(candidate.version, winner.version) > 0 ? candidate : winner,
  );
  return best.id;
}

/** Ask the node which of its installed applications is this one. */
export async function resolveApplicationId(
  admin: MeroJs['admin'],
): Promise<string> {
  try {
    const res = await admin.listApplications();
    const apps = (res?.apps ?? []) as InstalledApp[];
    return pickApplicationId(Array.isArray(apps) ? apps : []);
  } catch {
    return '';
  }
}
