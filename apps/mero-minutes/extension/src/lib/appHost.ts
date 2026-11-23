/**
 * Where Calimero Cloud serves Minutes' page: `https://{label}.apps.calimero.network/{version}/`.
 * `label` is the unpadded lowercase base32 of SHA-256("calimero.app-host.v1\0" + package),
 * as core's `app_host::label` and packages/connect `appLabel` (checked against it in tests).
 */
export const PACKAGE = "com.calimero.mero-minutes";
export const APPS_DOMAIN = "apps.calimero.network";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export function base32(bytes: Uint8Array): string {
  let out = "";
  let acc = 0;
  let bits = 0;
  for (const byte of bytes) {
    acc = ((acc << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(acc >>> bits) & 31];
    }
  }
  if (bits > 0) out += BASE32[(acc << (5 - bits)) & 31];
  return out;
}

export async function appLabel(pkg: string, crypto: Crypto = globalThis.crypto): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`calimero.app-host.v1\0${pkg}`));
  return base32(new Uint8Array(digest));
}

export async function appOrigin(pkg: string = PACKAGE, domain: string = APPS_DOMAIN): Promise<string> {
  return `https://${await appLabel(pkg)}.${domain}`;
}

/** One path segment a release may be: letters, digits, `.`, `-`, `+`, starting alphanumeric. */
export function isVersion(value: string): boolean {
  return value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(value);
}

/** The newest release `origin` serves, from its `/.well-known/calimero.json` (oldest first). */
export async function latestVersion(origin: string, fetcher: typeof fetch = fetch): Promise<string> {
  const url = `${origin.replace(/\/+$/, "")}/.well-known/calimero.json`;
  const res = await fetcher(url);
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}: Minutes is not served there yet`);
  const info = (await res.json()) as { versions?: unknown };
  const versions = Array.isArray(info.versions) ? info.versions.filter((v): v is string => typeof v === "string") : [];
  const latest = versions[versions.length - 1];
  if (!latest) throw new Error("The app host serves no release of Minutes yet");
  if (!isVersion(latest)) throw new Error("The app host names a release that is not a version");
  return latest;
}

/**
 * Where to sign in: the override (a development page such as
 * `http://localhost:5173`, served at its root), or Cloud's served page at its
 * newest release.
 */
export async function servedPage(
  override: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<{ origin: string; version: string | null }> {
  const o = override?.trim();
  if (o) return { origin: o.replace(/\/+$/, ""), version: null };
  const origin = await appOrigin();
  return { origin, version: await latestVersion(origin, fetcher) };
}

/** A link to a meeting on the page (the page's router reads `#/meetings/{app}/{id}`). */
export function meetingLink(page: { origin: string; version: string | null }, app: string, meeting: string): string {
  const path = page.version ? `/${page.version}/` : "/";
  return `${page.origin}${path}#/w/${encodeURIComponent(app)}/m/${encodeURIComponent(meeting)}`;
}

export function workspaceLink(page: { origin: string; version: string | null }, app?: string): string {
  const path = page.version ? `/${page.version}/` : "/";
  return app ? `${page.origin}${path}#/w/${encodeURIComponent(app)}` : `${page.origin}${path}`;
}
