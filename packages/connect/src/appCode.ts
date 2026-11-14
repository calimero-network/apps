/**
 * Does the node run this app's exact code? The node binds its own record of
 * the instance's bundle hash into an attestation ({@link CalimeroClient.attestApp});
 * a hash the page pinned would only be echoed back, so it proves nothing. The
 * node-bound hash is compared with the hash the app's source says it is: the
 * signed release's bundle hash from the registry, or the raw dev bundle.
 */
import type { CalimeroClient } from "@calimero-network/mero-js";

import { instanceRelease, type ReleaseClient } from "./release";
import type { AppSource } from "./target";

/** What {@link checkAppCode} reads. */
export type CodeCheckClient = Pick<CalimeroClient, "attestApp" | "packageCapabilities"> & ReleaseClient;

/** `match` only when both hashes are present and equal; anything not checked is `unknown`. */
export type AppCodeCheck =
  | { status: "match"; appHash: string; checkedAt: number }
  | { status: "mismatch"; appHash: string; expected: string }
  | { status: "unknown"; reason: string };

const normalize = (hash: string | undefined): string => (hash ?? "").trim().toLowerCase();

async function expectedBundle(client: CodeCheckClient, app: string, source: AppSource): Promise<string> {
  if (typeof source === "string") return source;
  const version = source.version ?? (await instanceRelease(client, app));
  if (!version) throw new Error(`the release of ${source.package} that ${app} runs is not known`);
  return (await client.packageCapabilities(source.package, version)).bundle;
}

/**
 * Attests instance `app` and compares the hash the node bound with the bundle
 * hash of `source`: the release it runs (`source.version`, else the one the
 * instance reports) or a raw bundle hash. Never throws.
 */
export async function checkAppCode(client: CodeCheckClient, app: string, source: AppSource): Promise<AppCodeCheck> {
  try {
    const expected = normalize(await expectedBundle(client, app, source));
    if (!expected) throw new Error("the app's release lists no bundle hash");
    const verified = await client.attestApp(app);
    if (!verified.appHash) throw new Error("the node bound no code hash for this app");
    const appHash = normalize(verified.appHash);
    return appHash === expected
      ? { status: "match", appHash, checkedAt: verified.checkedAt }
      : { status: "mismatch", appHash, expected };
  } catch (e) {
    return { status: "unknown", reason: e instanceof Error ? e.message : String(e) };
  }
}
