/** Does the attested node run the release's code? Both hashes come from the same node: a consistency check, not a registry or signature check. */
import type { CalimeroClient } from "@calimero-network/mero-js";

import { instancePackage, type ReleaseClient } from "./release";
import type { AppSource } from "./target";

/** What {@link checkAppCode} reads. */
export type CodeCheckClient = Pick<CalimeroClient, "attestApp" | "packageCapabilities"> & ReleaseClient;

/** `match` only when both hashes are present and equal; anything not checked is `unknown`. */
export type AppCodeCheck =
  | { status: "match"; appHash: string; checkedAt: number; package?: string; version?: string }
  | { status: "mismatch"; appHash: string; expected: string }
  | { status: "unknown"; reason: string };

const normalize = (hash: string | undefined): string => (hash ?? "").trim().toLowerCase();

/** The bundle hash `source` stands for, and the release the instance runs (none for a dev bundle). */
async function expectedBundle(
  client: CodeCheckClient,
  app: string,
  source: AppSource,
): Promise<{ bundle: string; release?: { package: string; version: string } }> {
  if (typeof source === "string") return { bundle: source };
  const running = await instancePackage(client, app);
  if (!running) throw new Error(`the release of ${source.package} that ${app} runs is not known`);
  if (running.package !== source.package) throw new Error(`${app} runs ${running.package}, not ${source.package}`);
  if (running.compute) throw new Error("compute-only instance");
  const listed = await client.packageCapabilities(
    running.package,
    running.version,
    running.service ? { service: running.service } : undefined,
  );
  if ((running.service ?? null) !== (listed.service ?? null)) {
    throw new Error(`${app} runs service ${running.service ?? "default"}, not the ${listed.service ?? "default"} one ${running.version} lists`);
  }
  return { bundle: listed.bundle, release: { package: running.package, version: running.version } };
}

/**
 * Attests instance `app` and compares the hash the node bound with the bundle
 * hash of `source`: the release the instance runs (its own report, not
 * `source.version`) or a raw bundle hash. A mock quote is never a match. Never throws.
 */
export async function checkAppCode(client: CodeCheckClient, app: string, source: AppSource): Promise<AppCodeCheck> {
  try {
    const { bundle, release } = await expectedBundle(client, app, source);
    const expected = normalize(bundle);
    if (!expected) throw new Error("the app's release lists no bundle hash");
    const verified = await client.attestApp(app);
    if (verified.mock) throw new Error("test server: the node's quote is a mock");
    if (!verified.appHash) throw new Error("the node bound no code hash for this app");
    const appHash = normalize(verified.appHash);
    return appHash === expected
      ? { status: "match", appHash, checkedAt: verified.checkedAt, ...release }
      : { status: "mismatch", appHash, expected };
  } catch (e) {
    return { status: "unknown", reason: e instanceof Error ? e.message : String(e) };
  }
}
