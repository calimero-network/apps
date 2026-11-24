import { CalimeroClient } from "@calimero-network/mero-js";

/**
 * The cluster's API URLs. The cluster serves this page from Mero AR's bundle
 * at `{label}.{apps_domain}` and publishes its nodes at
 * `/.well-known/calimero.json`; the page's CSP lets it reach those and
 * nothing else. `null` anywhere else (the dev server, no such file).
 */
export async function servedNodes(
  origin: string | undefined = globalThis.location?.origin,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<string[] | null> {
  if (!origin || !/^https?:/.test(origin)) return null;
  try {
    const response = await fetcher(new URL("/.well-known/calimero.json", origin).toString(), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const api = ((await response.json()) as { api?: unknown } | null)?.api;
    if (!Array.isArray(api)) return null;
    const nodes = api.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u));
    return nodes.length > 0 ? nodes : null;
  } catch {
    return null;
  }
}

/** Why the page can't sign anyone in. */
export class NotServedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotServedError";
  }
}

/**
 * A client for the cluster serving this page, failing over across its nodes.
 * Every node is attested before anything is sent to it: a signed mero-tee
 * release at or above `VITE_CALIMERO_MIN_RELEASE`, fixed when the page is built.
 */
export async function connect(
  minReleaseVersion: string | undefined = import.meta.env.VITE_CALIMERO_MIN_RELEASE,
  find: () => Promise<string[] | null> = () => servedNodes(),
): Promise<CalimeroClient> {
  const floor = minReleaseVersion?.trim();
  if (!floor) throw new NotServedError("This page was built without an attestation floor.");
  const nodes = await find();
  const [baseUrl, ...rest] = nodes ?? [];
  if (!baseUrl) throw new NotServedError("Open Mero AR on your iPhone to sign in.");
  return new CalimeroClient({ baseUrl, nodes: rest, policy: { release: { minReleaseVersion: floor } } });
}
