import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import {
  createInviteStore,
  inviteLink,
  targetKey,
  type AppSource,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
  type Target,
} from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";

import { APP } from "./session";

/** The link parameter naming the arena an invite opens. */
const ARENA_PARAM = "arena";

/**
 * An arena is an app instance: v1's context. Arenas live in an organization
 * (v1's namespace, the "dojo"), whose members reach every arena in it, so one
 * invitation lets an opponent into all of them.
 */

/** The arenas the account reaches: of the dev bundle, or of the package. */
export async function listArenas(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps = await client.listApps(filter);
  return [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/**
 * A new arena named `name`. In `org` when given (v1: another context in a
 * namespace you have), otherwise in a new organization of its own (v1's "New
 * arena" made a namespace and a context in it). `now` is the creator's clock,
 * the arena's `createdAt`.
 */
export async function createArena(
  client: Pick<CalimeroClient, "createApp" | "createOrg">,
  source: AppSource,
  name: string,
  org?: string,
  now: number = Date.now(),
): Promise<{ appId: string; org: string }> {
  const inOrg = org ?? (await client.createOrg(name));
  const appId = await client.createApp(name, source, {
    org: inOrg,
    initArgs: { title: name, now: String(Math.floor(now)) },
  });
  return { appId, org: inOrg };
}

/** An invitation into `org` as a member, approved with the inviter's passkey (412 step-up). */
export function inviteToken(
  client: Pick<CalimeroClient, "invite">,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.invite(org, "member", passkey);
}

/**
 * Where this frontend's routes live: `/`, or under the node's `/{version}/`.
 * A version-pinned invite link's route is read relative to it.
 */
export const basename = (): string => nodeBasename(new URL(window.location.href), "/");

/**
 * This app's pending invite (`createInviteStore` in `@calimero-apps/connect`),
 * with the arena its link names (`&arena=`, kept as `extra.arena`): captured
 * in `main.tsx` before React mounts, then bound to the cluster, held for the
 * account that signs in with it and dropped on sign-out by the passkey
 * session (`usePasskeySession({ invites })`).
 */
export const invites: InviteStore = createInviteStore(APP, { keep: [ARENA_PARAM] });

/** The arena a pending invite's link names, opened once it is redeemed. */
export function invitedArena(invite: PendingInvite | null): string | null {
  return invite?.extra[ARENA_PARAM] ?? null;
}

/**
 * The link that opens this frontend with `token` to redeem and `arena` to open
 * after. It also names `org`: the token does not say which org it is for until
 * it is redeemed, and redeeming spends one of its uses even for someone already
 * in the org, so the link carries it for the app to tell a member "you are
 * already in" first.
 *
 * Pinned to the router's basename (the served `/{version}/`): `inviteLink`
 * defaults to the origin's root, which a cluster redirects to the newest
 * release only with core's served-redirect fix (it keeps the query); until
 * every cluster runs it, the link stays pinned. `/` sends an invited visitor on
 * to the play page.
 */
export function arenaInviteLink(token: string, arena: string, org: string): string {
  return inviteLink(token, { org, root: basename(), extra: { [ARENA_PARAM]: arena } });
}

/** The key this app kept its pending invite under before the shared store: `{ token, arena, org }`. */
const LEGACY_INVITE = `${APP}:pending-invite`;

/**
 * Moves an invite stored by an older build of this app into `store`, unless
 * the store holds one already (a link opened just now wins), and forgets the
 * old key.
 */
export function migrateStoredInvite(
  store: InviteStore,
  storage: KeyValueStorage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  let raw: string | null;
  try {
    raw = storage.getItem(LEGACY_INVITE);
  } catch {
    return;
  }
  if (raw && !store.pending()) {
    try {
      const old = JSON.parse(raw) as { token?: unknown; arena?: unknown; org?: unknown };
      if (typeof old.token === "string" && old.token) {
        store.put({
          token: old.token,
          org: typeof old.org === "string" && old.org ? old.org : null,
          team: null,
          doc: null,
          route: null,
          extra: typeof old.arena === "string" && old.arena ? { [ARENA_PARAM]: old.arena } : {},
        });
      }
    } catch {
      /* not an invite */
    }
  }
  try {
    storage.removeItem(LEGACY_INVITE);
  } catch {
    /* nothing stored */
  }
}

/**
 * The arena to open in `org` (the one an invite joined, or the account was
 * already in): the arena the link named when the account reaches it, else
 * `prefer` (the one opened last) when it is in `org`, else the first by name.
 * `null` when the account reaches none there yet.
 */
export function arenaIn(
  arenas: AppInfo[],
  org: string | null,
  named?: string | null,
  prefer?: string | null,
): AppInfo | null {
  const asked = named ? arenas.find((a) => a.appId === named) : undefined;
  if (asked) return asked;
  if (!org) return null;
  const inOrg = arenas.filter((a) => a.org === org);
  return inOrg.find((a) => a.appId === prefer) ?? inOrg[0] ?? null;
}

/** The arena last opened on this target by this account, remembered across loads. */
export function selectionKey(target: Target, accountId: string): string {
  return `${APP}:arena:${targetKey(target)}:${accountId}`;
}
