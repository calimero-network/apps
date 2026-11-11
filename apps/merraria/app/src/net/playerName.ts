// The name a player shows others in a world: asked once per world's org, when
// the player creates the world or joins it by invite, and kept in the org's
// member metadata `{ name }`. Entering a world reads it from there and feeds
// the contract's `join {name}` without asking again.
//
// `mt-name` is the key every world used before this: a world whose org has
// no name yet adopts it (or the name last used in another world) silently.

import { lastUsedName, orgMemberName, setOrgName } from "@calimero-apps/names";
import type { KeyValueStorage, ClientRoutes } from "@calimero-apps/connect";

/** The per-app key the launcher's name field wrote before names lived on the org. */
export const OLD_NAME_KEY = "mt-name";

/** What the player last called themselves on this browser, or "". */
export function knownName(storage: KeyValueStorage = localStorage): string {
  let old = "";
  try {
    old = storage.getItem(OLD_NAME_KEY)?.trim() ?? "";
  } catch {
    /* storage refused: no older name */
  }
  return lastUsedName() || old;
}

/**
 * The player's name in `org`: `ready` once the org answered (an empty name
 * then means it holds none), `false` when it could not be read.
 */
export async function readOrgName(
  client: ClientRoutes<{ orgs: "get" }>,
  org: string,
  account: string,
): Promise<{ ready: boolean; name: string }> {
  try {
    const info = await client.orgs.get({ org });
    const meta = info?.memberMetadata;
    return { ready: true, name: orgMemberName(meta && typeof meta === "object" ? (meta as Record<string, unknown>) : null, account) };
  } catch {
    return { ready: false, name: "" };
  }
}

/** Write `name` as the player's name in `org` (merged into their member record). Throws when the node refuses. */
export function saveOrgName(
  client: ClientRoutes<{ orgs: "get" | "memberMetadata" }>,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  return setOrgName(client, org, account, name);
}
