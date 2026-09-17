// Resolving mero-drive's OWN application id.
//
// This used to be `useMero().applicationId || VITE_APPLICATION_ID` — the id
// MeroProvider resolved during whichever login last ran on this origin, or one
// baked into the hosting project at build time. Neither describes which app
// this is:
//
//   * Two apps served from `localhost:5173` in one browser share a
//     `localStorage`, so opening mero-drive after another Calimero app
//     inherits that app's session and, with it, its application id. Every
//     namespace read is scoped by that id, so the workspace switcher lists the
//     OTHER app's namespaces and a freshly accepted invite appears to have
//     joined nothing — the list is filtering correctly, for the wrong app.
//
//   * `VITE_APPLICATION_ID` is worse: an ApplicationId is per-INSTALL, so a
//     value baked into a Vercel project is an id no node has as soon as the
//     bundle is republished. mero-design shipped that way and every namespace
//     create failed with an opaque 500 that never mentions application ids.
//
// The node is the only source that can answer "which installed app am I". So
// ask it, and match on the bundle's `package` — the identity the registry and
// the desktop launcher both resolve by, and the one thing that does not change
// between releases, machines or sessions.

import type { MeroJs } from '@calimero-network/mero-js';
import { PACKAGE_NAME } from '@/constants/config';

/** One row of the node's installed-application list, narrowed to what we match on. */
export interface InstalledApp {
  id: string;
  /** Absent on a bootstrap stub row and on a raw-wasm install (no signed bundle). */
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
 * Returns `''` when this app is not installed, rather than guessing. `apps[0]`
 * — the obvious fallback — is whichever app the node happens to list first,
 * which is the wrong-app bug above with extra steps. An empty id makes the
 * caller say "not installed here", which is the truth and is actionable.
 *
 * When several installs share the package — a registry build and a locally
 * dev-signed one have DIFFERENT ids, because an id is `hash(package, signer)`
 * — prefer the highest version, so a freshly published bundle wins over a
 * stale one.
 */
export function pickApplicationId(apps: readonly InstalledApp[]): string {
  const mine = apps.filter((a) => a?.package === PACKAGE_NAME && !!a.id);
  if (mine.length === 0) return '';
  // Stable: equal versions keep the node's own ordering rather than swapping
  // between reads, which would move the workspace list under the user.
  const best = mine.reduce((winner, candidate) =>
    compareVersions(candidate.version, winner.version) > 0 ? candidate : winner,
  );
  return best.id;
}

/**
 * True when NO row carried a `package` at all.
 *
 * A node that installed this app from a raw `.wasm` (what `scripts/dev-node.sh`
 * does) files it with no package, so matching by package cannot succeed and
 * `''` would mean "I can't tell", not "not installed". Only in that case is
 * falling back to the session's id better than refusing to run, so the caller
 * needs the two apart.
 */
export function listIsPackageAware(apps: readonly InstalledApp[]): boolean {
  return apps.some((a) => typeof a?.package === 'string' && a.package !== '');
}

export interface ResolvedApplicationId {
  /** The id, or `''` when this app is not installed on the node. */
  id: string;
  /** False when no installed row carried a package — `id === ''` is then inconclusive. */
  packageAware: boolean;
}

/** Ask the node which of its installed applications is this one. */
export async function resolveApplicationId(
  admin: MeroJs['admin'],
): Promise<ResolvedApplicationId> {
  try {
    const res = await admin.listApplications();
    const raw = res?.apps ?? [];
    const apps = (Array.isArray(raw) ? raw : []) as InstalledApp[];
    return { id: pickApplicationId(apps), packageAware: listIsPackageAware(apps) };
  } catch {
    // A failed list is not "not installed" — say so, so the caller keeps its
    // fallback rather than rendering a confident "install mero-drive first".
    return { id: '', packageAware: false };
  }
}
