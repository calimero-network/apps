import type { LensHost } from "./lens/lens";
import { identitiesOf } from "./collector";
import type { OtherApps } from "./otherApps";
import { type ClientRoutes } from "@calimero-apps/connect";

/**
 * What a lens runs against on the cluster: the event's app's own reads, who
 * you are, and people's names.
 *
 * Names are not an app's business: every app lives in an organization, and a
 * person's name is their member metadata there (`getOrg(org)`'s
 * `memberMetadata[account].name`). v1 read the same thing from namespace
 * member metadata.
 */

/** Which names an organization's listing gives, asked again after this long. */
const NAMES_FRESH_MS = 60_000;

/** The slice of the client this needs. */
export type NamesClient = ClientRoutes<{ orgs: "get" }>;

/** `{ account: name }` from an organization as `getOrg` answers it. */
export function memberNamesOf(org: Record<string, unknown> | null): Map<string, string> {
  const out = new Map<string, string>();
  const meta = (org?.memberMetadata ?? org?.member_metadata ?? {}) as Record<string, unknown>;
  for (const [account, value] of Object.entries(meta)) {
    const v = (value ?? {}) as { name?: unknown; displayName?: unknown };
    const name = typeof v.name === "string" ? v.name : typeof v.displayName === "string" ? v.displayName : "";
    if (name.trim()) out.set(account, name.trim());
  }
  return out;
}

/**
 * A lens host per app instance. `orgOf` says which organization an app is in
 * (null for an app of your own); `account` is the signed-in account.
 */
export function clusterLensHosts(
  apps: OtherApps,
  client: NamesClient,
  account: string,
  orgOf: (app: string) => string | null,
  now: () => number = Date.now,
) {
  const me = identitiesOf([account]);
  const names = new Map<string, { names: Promise<Map<string, string>>; at: number }>();

  const namesIn = (org: string): Promise<Map<string, string>> => {
    const hit = names.get(org);
    if (hit && now() - hit.at < NAMES_FRESH_MS) return hit.names;
    const read = client.orgs.get({ org })
      .then((o) => memberNamesOf(o as Record<string, unknown>))
      .catch(() => new Map<string, string>());
    names.set(org, { names: read, at: now() });
    return read;
  };

  return (app: string): LensHost => ({
    call: <T,>(method: string, args: Record<string, unknown>) => apps.view(app, method, args) as Promise<T>,
    me: async () => me,
    name: async (identity: string) => {
      const org = orgOf(app);
      if (!org) return "";
      const known = await namesIn(org);
      for (const id of identitiesOf([identity])) {
        const name = known.get(id);
        if (name) return name;
      }
      return "";
    },
  });
}
