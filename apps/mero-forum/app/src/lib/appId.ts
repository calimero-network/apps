import type { MeroJs } from "@calimero-network/mero-js";

/**
 * Resolving Mero Forum's OWN application id.
 *
 * This used to be `getApplicationId() ?? providerAppId` — the id carried in the
 * session or handed over by MeroProvider. Both are properties of how you
 * arrived, not of which app you are, and on a shared origin they belong to
 * whoever logged in last. Two apps served from `localhost:5173` in one browser
 * share a `localStorage`, so opening Mero Forum after Mero Design inherited
 * Design's session — and with it Design's application id. Every namespace read
 * is scoped by that id, so the stream picker listed Design's namespaces and
 * looked like it was ignoring the filter entirely. It was not: it was filtering
 * correctly, for the wrong app.
 *
 * The node is the only source that can answer "which installed app is me". So
 * ask it, and match on the bundle's `package` — the same identity the registry
 * and the desktop launcher resolve by, and the one thing that does not change
 * between releases, machines or sessions.
 *
 * Deliberately NOT read from an env var. A stale `VITE_APPLICATION_ID` baked
 * into a hosting project is how mero-design once shipped a build pinned to an
 * id no node had, failing every namespace create with an opaque 500 that never
 * mentions application ids.
 */

/** Keep equal to `package` in `logic/Cargo.toml` and to `packageName` in main.tsx. */
export const APP_PACKAGE =
  (import.meta.env.VITE_APPLICATION_PACKAGE as string | undefined)?.trim() ||
  "com.calimero.mero-forum";

export interface InstalledApp {
  id: string;
  package?: string;
  /** Absent when the stored version is empty or not valid semver. */
  version?: string;
}

/** Compare two `X.Y.Z` strings numerically. Anything unparseable sorts lowest. */
function compareVersions(a: string | undefined, b: string | undefined): number {
  const parse = (v: string | undefined) =>
    (v ?? "").split(".").map((part) => {
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
 * is exactly the wrong-app bug above with extra steps. An empty id makes the
 * caller show "not installed", which is the truth and is actionable.
 *
 * When several installs share the package (a registry build and a locally
 * dev-signed one, which have DIFFERENT ids because the id is
 * `hash(package, signer)`), prefer the highest version so a freshly published
 * bundle wins over a stale one.
 */
export function pickApplicationId(apps: readonly InstalledApp[]): string {
  const mine = apps.filter((a) => a?.package === APP_PACKAGE && !!a.id);
  if (mine.length === 0) return "";
  // Stable: equal versions keep the node's own ordering rather than swapping
  // between reads, which would move the picker under the user.
  const best = mine.reduce((winner, candidate) =>
    compareVersions(candidate.version, winner.version) > 0 ? candidate : winner,
  );
  return best.id;
}

/** Ask the node which of its installed applications is this one. */
export async function resolveApplicationId(
  admin: MeroJs["admin"],
): Promise<string> {
  try {
    const res = await admin.listApplications();
    const apps = (res?.apps ?? []) as InstalledApp[];
    return pickApplicationId(Array.isArray(apps) ? apps : []);
  } catch {
    return "";
  }
}
