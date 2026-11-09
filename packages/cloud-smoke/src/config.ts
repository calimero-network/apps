import { APPS_DOMAIN, appUrl } from "@calimero-apps/connect";

/** What every run checks unless `SMOKE_PACKAGES` says otherwise. */
export const DEFAULT_PACKAGES = ["com.calimero.kv-store"];

/**
 * The origin every served page must be allowed to reach: mero-js's
 * `cloud-v2/attestation.ts` fetches the signed node release
 * (`/api/tee/node-releases/{v}`) and Intel's collateral (`/api/tee/pcs`) from
 * it before it sends a node anything.
 */
export const CLOUD_MIRROR = "https://cloud.calimero.network";

export interface SmokeTarget {
  package: string;
  /** `https://{label}.{apps domain}/`, or the override for it. */
  url: string;
}

/** `com.a, com.b` / `com.a com.b` / newline separated; empty means the default. */
export function parsePackages(raw: string | undefined): string[] {
  const list = (raw ?? "")
    .split(/[\s,]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return list.length > 0 ? [...new Set(list)] : DEFAULT_PACKAGES;
}

/**
 * The served apps to check, from the environment:
 * - `SMOKE_PACKAGES`: package ids (default `com.calimero.kv-store`);
 * - `SMOKE_APPS_DOMAIN`: the apps domain (default `apps.calimero.network`);
 * - `SMOKE_URL`: one URL to check instead (a single package only), for a host
 *   that is not `{label}.{apps domain}`.
 */
export function smokeTargets(env: NodeJS.ProcessEnv = process.env): SmokeTarget[] {
  const packages = parsePackages(env.SMOKE_PACKAGES);
  const override = env.SMOKE_URL?.trim();
  if (override) {
    if (packages.length !== 1) throw new Error("SMOKE_URL names one app: give SMOKE_PACKAGES one package with it");
    return [{ package: packages[0] as string, url: override }];
  }
  const domain = env.SMOKE_APPS_DOMAIN?.trim() || APPS_DOMAIN;
  return packages.map((pkg) => ({ package: pkg, url: appUrl(pkg, domain) }));
}
