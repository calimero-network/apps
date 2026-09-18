// ── Resolving MeroSign's OWN application id ──────────────────────────────────
//
// What was here before:
//
//     const applicationId = import.meta.env.VITE_APPLICATION_ID;
//     if (!applicationId) throw new Error('Application ID not available …');
//
// with `.env.example` shipping `GXtgv6t5u8QwtXGcxYHvDbEge7EHo1ewupnrmWnAKamo`
// to copy. Two things are wrong with that, and both fail silently:
//
//   1. **An ApplicationId is assigned PER INSTALL.** It is `hash(package,
//      signer)`, so the id is correct only on the machine it was copied from. A
//      request naming an application the node has never installed comes back as
//      an opaque 500 that does not mention application ids at all — this is the
//      same failure that shipped mero-design pinned to an id no node had.
//   2. **It is base58**, which core 0.11.0-rc.27 stopped using. The value in
//      `.env.example` cannot be right on any current node.
//
// The node is the only thing that can answer "which installed app is me". So
// ask it, and match on the bundle's `package` — the same identity the registry
// and the desktop launcher resolve by, and the one string that does not change
// between releases, machines or sessions.
//
// ⚠️ NOT `apps[0]`. The obvious fallback is what once pointed scaffolding-e2e at
// a kv-store context and ran its suite against the wrong contract. An unknown id
// returns "" so the caller can say "this app is not installed on your node",
// which is the truth and is actionable.

import { PACKAGE_NAME } from '../constants/config';

/**
 * The package to match on — the same constant `<CalimeroProvider>` logs in with
 * and `lib/inviteLink` builds links from, so all three cannot disagree.
 * Mirrors `[package.metadata.calimero].package` in `logic/Cargo.toml`.
 */
export const APP_PACKAGE = PACKAGE_NAME;

/**
 * One row of `GET /admin-api/applications`.
 *
 * ⚠️ `package` and `version` are NOT in this SDK's `InstalledApplication`
 * interface — `@calimero-network/calimero-client@1.25.0-beta.2` still types the
 * row as `{id, blob, version, source, metadata}`. Core does serve them (mero-js
 * 19's `Application` has both), the client's type is simply behind. Typed here
 * as optional so a node that really does omit them degrades to "not found"
 * rather than throwing.
 */
export interface InstalledApp {
  id: string;
  package?: string;
  version?: string;
  /** The bundle manifest, as bytes. The fallback when `package` is absent. */
  metadata?: number[];
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
 * The package an installed row belongs to.
 *
 * Prefers the `package` field. Falls back to parsing `metadata` — the bundle
 * manifest the node stores verbatim as bytes — and reading `package` out of it.
 * Deliberately NOT a substring search over the decoded bytes: "does this blob
 * contain my package name somewhere" would also match an app that merely
 * mentions us, and picking the wrong application id is the failure this module
 * exists to prevent. If the manifest is not JSON with a `package` in it, we do
 * not know, and we say so.
 */
export function packageOf(app: InstalledApp): string | undefined {
  if (typeof app.package === 'string' && app.package.trim()) {
    return app.package.trim();
  }
  if (!Array.isArray(app.metadata) || app.metadata.length === 0) {
    return undefined;
  }
  try {
    const text = new TextDecoder().decode(new Uint8Array(app.metadata));
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const pkg = parsed?.package;
    return typeof pkg === 'string' && pkg.trim() ? pkg.trim() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Pick this app's id out of everything installed on the node.
 *
 * Returns "" when this app is not installed, rather than guessing.
 *
 * When several installs share the package — a registry build and a locally
 * dev-signed one, which have DIFFERENT ids because the id is
 * `hash(package, signer)` — prefer the highest version, so a freshly published
 * bundle wins over a stale one. Stable on equal versions: it keeps the node's
 * own ordering rather than swapping between reads.
 */
export function pickApplicationId(apps: readonly InstalledApp[]): string {
  const mine = apps.filter((a) => !!a?.id && packageOf(a) === APP_PACKAGE);
  if (mine.length === 0) return '';
  const best = mine.reduce((winner, candidate) =>
    compareVersions(candidate.version, winner.version) > 0 ? candidate : winner,
  );
  return best.id;
}

/**
 * Pull the rows out of whatever shape the node answered with.
 *
 * `apiClient` hands back the raw response body and does not unwrap, so this
 * route arrives as `{data: {apps: […]}}` on current core, and has been seen as
 * `{apps: […]}` and as a bare array. Accepting all three costs three lines and
 * removes a whole class of "works on my node" bug.
 */
export function appsFromResponse(body: unknown): InstalledApp[] {
  const unwrapped =
    body && typeof body === 'object' && 'data' in body
      ? (body as { data: unknown }).data
      : body;
  if (Array.isArray(unwrapped)) return unwrapped as InstalledApp[];
  if (unwrapped && typeof unwrapped === 'object') {
    const apps = (unwrapped as { apps?: unknown }).apps;
    if (Array.isArray(apps)) return apps as InstalledApp[];
  }
  return [];
}

/**
 * Ask the node which of its installed applications is this one.
 *
 * `listApps` is injected rather than imported so this module stays free of the
 * SDK — `@calimero-network/calimero-client` publishes CommonJS under
 * `"type": "module"`, which Node's ESM resolver refuses outright, so importing
 * it here would make every test in this file unrunnable. The one caller passes
 * `apiClient.node().getInstalledApplications`.
 *
 * Cached for the page's lifetime: the answer only changes when this app is
 * installed or removed, and re-asking on every context creation is a round trip
 * for a constant.
 */
let cached: string | null = null;

export type ListApps = () => Promise<{
  data?: unknown;
  error?: { message?: string } | null;
}>;

export async function resolveApplicationId(
  listApps: ListApps,
): Promise<string> {
  if (cached !== null) return cached;
  try {
    const res = await listApps();
    if (res.error) {
      console.warn('Could not list installed applications:', res.error);
      return '';
    }
    const id = pickApplicationId(appsFromResponse(res.data));
    // Only a positive answer is cached. Caching "" would pin the app to "not
    // installed" for the rest of the session, including across the install that
    // would have fixed it.
    if (id) cached = id;
    return id;
  } catch (error) {
    console.warn('Could not list installed applications:', error);
    return '';
  }
}

/** Test seam, and the hatch for a node that has just installed the app. */
export function clearApplicationIdCache(): void {
  cached = null;
}
