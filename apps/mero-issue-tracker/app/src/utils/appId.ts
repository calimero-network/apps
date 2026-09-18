/**
 * Resolving Mero Issue Tracker's OWN application id, from the node.
 *
 * `useWorkspace` used to take `useMero().applicationId || VITE_APPLICATION_ID`.
 * Both describe how you ARRIVED, not which app you are:
 *
 *   - the session's id is whatever the last login callback carried, and two apps
 *     served from one origin share a `localStorage`, so opening the tracker after
 *     another mero app in the same browser inherits that app's id. Every
 *     namespace read is scoped by it, so the workspace switcher lists the other
 *     app's workspaces and looks like it is ignoring the filter. It is not — it
 *     is filtering correctly, for the wrong app.
 *   - a baked `VITE_APPLICATION_ID` is how mero-design once shipped a build
 *     pinned to an id no node had, failing every namespace create with an opaque
 *     500 that never mentions application ids.
 *
 * The node is the only thing that can answer "which installed app is me", so ask
 * it and match on the bundle's `package` — the same identity the registry and the
 * desktop launcher resolve by, and the one value that does not change between
 * releases, machines or sessions. It is declared once in
 * `logic/Cargo.toml` (`[package.metadata.calimero].package`) and mirrored into
 * `studio.config.json`, which is where `APP_PACKAGE` comes from.
 */
import type { MeroJs } from '@calimero-network/mero-js';
import { APP_PACKAGE } from '../config';

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
 * is the wrong-app bug above with extra steps. An empty id surfaces as "not
 * installed", which is the truth and is actionable.
 *
 * When several installs share the package (a registry build and a locally
 * dev-signed one have DIFFERENT ids, because an id is `hash(package, signer)`),
 * prefer the highest version so a freshly published bundle wins over a stale one.
 */
export function pickApplicationId(apps: readonly InstalledApp[]): string {
  const mine = apps.filter((a) => a?.package === APP_PACKAGE && !!a.id);
  if (mine.length === 0) return '';
  // Stable: equal versions keep the node's own ordering rather than swapping
  // between reads, which would move the workspace list under the user.
  const best = mine.reduce((winner, candidate) =>
    compareVersions(candidate.version, winner.version) > 0 ? candidate : winner,
  );
  return best.id;
}

/** Ask the node which of its installed applications is this one. */
export async function resolveApplicationId(admin: MeroJs['admin']): Promise<string> {
  try {
    const res = await admin.listApplications();
    const apps = (res?.apps ?? []) as InstalledApp[];
    return pickApplicationId(Array.isArray(apps) ? apps : []);
  } catch {
    return '';
  }
}
