/**
 * Calimero Cloud serves each release at its own path (`/0.0.3/`) and keeps
 * the old ones, so a link saved earlier (a bookmark, an invite, the extension
 * signed in last week) still opens an old page. Opened at an older release
 * than the one the host serves now, the page moves itself to it, keeping the
 * rest of the address (its query and fragment carry invites and handoffs).
 */

const VERSION_PATH = /^\/(\d+(?:\.\d+)*(?:[+-][0-9A-Za-z.+-]*)?)(\/.*)?$/;

/** The release in a path (`/0.0.1/…` → `0.0.1`), or null for a page served at its root. */
export function versionInPath(pathname: string): string | null {
  return VERSION_PATH.exec(pathname)?.[1] ?? null;
}

/** Compares two release versions as numbers ("0.0.10" after "0.0.9"). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    const d = Number.isInteger(nx) && Number.isInteger(ny) ? nx - ny : x.localeCompare(y);
    if (d) return d;
  }
  return 0;
}

/**
 * The release the host serves now, from its `/.well-known/calimero.json`: the
 * one the deployment in the address runs (`?deployment=`), else the newest
 * any deployment runs, else the newest it holds.
 */
export function servedVersion(info: { versions?: unknown; deployments?: unknown }, deployment: string | null = null): string | null {
  const ok = (v: unknown): v is string => typeof v === "string" && /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(v);
  const deployments = Array.isArray(info.deployments)
    ? info.deployments.filter((d): d is { id?: unknown; version?: unknown } => !!d && typeof d === "object")
    : [];
  const mine = deployment ? deployments.find((d) => d.id === deployment) : undefined;
  if (mine && ok(mine.version)) return mine.version;
  const deployed = deployments.map((d) => d.version).filter(ok);
  const held = Array.isArray(info.versions) ? info.versions.filter(ok) : [];
  const pool = deployed.length ? deployed : held;
  return pool.length ? [...pool].sort(compareVersions).at(-1)! : null;
}

/** Where to go instead of `href`, or null to stay: only ever to a newer release, on the same host. */
export function newerPage(href: string, info: { versions?: unknown; deployments?: unknown }): string | null {
  const url = new URL(href);
  const current = versionInPath(url.pathname);
  if (!current) return null;
  const served = servedVersion(info, url.searchParams.get("deployment"));
  if (!served || compareVersions(served, current) <= 0) return null;
  const rest = VERSION_PATH.exec(url.pathname)?.[2] ?? "/";
  return `${url.origin}/${served}${rest}${url.search}${url.hash}`;
}

/**
 * Moves this page to the release its host serves now, when that is newer.
 * True when it is leaving (the caller renders nothing). Never waits long: a
 * host that does not answer in time leaves the page where it is.
 */
export async function moveToServedRelease(
  location: Pick<Location, "href" | "origin" | "replace"> = window.location,
  fetcher: typeof fetch = fetch,
  waitMs = 2_500,
): Promise<boolean> {
  if (!versionInPath(new URL(location.href).pathname)) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), waitMs);
  try {
    const res = await fetcher(`${location.origin}/.well-known/calimero.json`, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return false;
    const next = newerPage(location.href, (await res.json()) as { versions?: unknown; deployments?: unknown });
    if (!next) return false;
    location.replace(next);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
