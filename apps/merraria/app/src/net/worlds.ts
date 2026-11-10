// Worlds, invitations and the world last played.
//
// A world is an app instance (v1: a context). Each world is created in an
// organization of its own (v1: a namespace), whose members reach it; an
// invitation is an org invite (v1: a namespace invitation), made with the
// inviter's passkey and redeemed by whoever opens the link, after signing in
// and saying Join.

import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import {
  createInviteStore,
  inviteLink,
  isSpentInvite,
  joinedOrg,
  type AppSource,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
} from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";

import { bindExec, merraria } from "./merraria";
import { APP } from "./session";

/** A world as the picker and the game know it. */
export type World = Pick<AppInfo, "appId" | "name" | "org">;

/** The worlds this account reaches: of the dev bundle, or of the package. */
export async function listWorlds(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<World[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps = await client.listApps(filter);
  return [...apps]
    .sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId))
    .map(({ appId, name, org }) => ({ appId, name, org }));
}

/**
 * A new world: an org for it (so friends can be invited), the app instance in
 * it, then `createWorld` with its name and seed, which only the creator (the
 * instance's owner) may run.
 */
export async function createWorld(
  client: Pick<CalimeroClient, "createApp" | "createOrg" | "call" | "view">,
  source: AppSource,
  name: string,
  seed: number,
  after: () => void = () => {},
): Promise<World> {
  const org = await client.createOrg(name);
  after();
  const appId = await client.createApp(name, source, { org });
  after();
  await merraria(bindExec(client, appId, after)).createWorld(name, seed);
  return { appId, name, org };
}

/** An invitation into the world's org as a member, approved with the inviter's passkey (412 step-up). */
export function inviteToken(
  client: Pick<CalimeroClient, "invite">,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.invite(org, "member", passkey);
}

/** The link parameter naming the world an invite opens. */
const WORLD_PARAM = "world";
/** The link parameter naming who sent it: "Join {from}'s game as ...?". */
const FROM_PARAM = "from";

/**
 * This game's pending invite (`createInviteStore` in `@calimero-apps/connect`),
 * with the world its link names (`&world=`) and who sent it (`&from=`).
 * Captured in `main.ts` before anything renders; the launcher binds it to the
 * cluster, holds it for the account that signs in (another account's sign-in
 * drops it) and drops it on sign-out (`ui/landing.ts`).
 */
export const invites: InviteStore = createInviteStore(APP, { keep: [WORLD_PARAM, FROM_PARAM] });

/** The world a pending invite's link names. */
export function invitedWorld(invite: PendingInvite | null): string | null {
  return invite?.extra[WORLD_PARAM] ?? null;
}

/** Who sent a pending invite, as their link names them; `null` for a link that does not. */
export function inviter(invite: PendingInvite | null): string | null {
  return invite?.extra[FROM_PARAM] ?? null;
}

/** Where this frontend is served: `/`, or the node's `/{version}/`. */
export const basename = (): string => nodeBasename(new URL(window.location.href), "/");

/**
 * The link that opens this frontend with `token` to redeem. `org` names the
 * world's organization, so a player already in it (the inviter opening their
 * own link, say) is not made to spend the token's single use; `world` is the
 * world to enter after joining, `from` the inviter's name for the question the
 * invitee is asked. Pinned to the served `/{version}/` until every cluster
 * keeps the query on its root redirect.
 */
export function worldInviteLink(
  token: string,
  org: string,
  { world, from, root = basename() }: { world?: string | null; from?: string | null; root?: string } = {},
): string {
  return inviteLink(token, { org, root, extra: { [WORLD_PARAM]: world, [FROM_PARAM]: from } });
}

/** The keys this game kept its pending invite under before the shared store. */
const LEGACY_INVITE = `${APP}:pending-invite`;
const LEGACY_INVITE_ORG = `${APP}:pending-invite-org`;

/**
 * Moves an invite stored by an older build of this game (a bare token, and
 * its org under a second key) into `store`, unless the store holds one
 * already (a link opened just now wins), and forgets the old keys.
 */
export function migrateStoredInvite(
  store: InviteStore,
  storage: KeyValueStorage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  let token: string | null;
  let org: string | null;
  try {
    token = storage.getItem(LEGACY_INVITE);
    org = storage.getItem(LEGACY_INVITE_ORG);
  } catch {
    return;
  }
  if (token && !store.pending()) {
    store.put({ token, org: org || null, team: null, doc: null, route: null, extra: {} });
  }
  try {
    storage.removeItem(LEGACY_INVITE);
    storage.removeItem(LEGACY_INVITE_ORG);
  } catch {
    /* nothing stored */
  }
}

/** The world to enter in `org`: the one the link named when listed, else the first there. */
export function worldIn(worlds: World[], org: string | null, named?: string | null): World | null {
  const asked = named ? worlds.find((w) => w.appId === named) : undefined;
  if (asked) return asked;
  return org ? (worlds.find((w) => w.org === org) ?? null) : null;
}

/**
 * The world a pending invitation names, when this account already plays in
 * it: the token is then dropped UNSPENT. Redeeming it would spend the link's
 * single use on nobody, and leave the player it was meant for unable to join.
 * `null` when the link names no org (or world) the account reaches.
 */
export async function alreadyInInvitedWorld(
  client: Pick<CalimeroClient, "listApps">,
  source: AppSource,
  store: InviteStore = invites,
): Promise<World | null> {
  const invite = store.pending();
  if (!invite || (!invite.org && !invitedWorld(invite))) return null;
  const world = worldIn(await listWorlds(client, source).catch(() => []), invite.org, invitedWorld(invite));
  if (world) store.drop();
  return world;
}

/**
 * Redeem the pending invitation and answer the world it opens: the world the
 * link named, else the first in the org the invite joined. `null` when there
 * is no invite, or the org holds no world this frontend plays.
 *
 * The token is dropped once redeemed, or when the node refuses the invite for
 * good (`isSpentInvite`: unknown, used up, expired, its org gone). A lapsed
 * session (401), a rate limit (429), the cluster or the network down keep it
 * for another try; the error is thrown for the caller to say so
 * (`describeRedeemFailure`).
 */
export async function redeemPendingInvite(
  client: Pick<CalimeroClient, "redeemInvite" | "listApps">,
  source: AppSource,
  store: InviteStore = invites,
): Promise<World | null> {
  const invite = store.pending();
  if (!invite) return null;
  let answer: unknown;
  try {
    answer = await client.redeemInvite(invite.token);
  } catch (e) {
    if (isSpentInvite(e)) store.drop();
    throw e;
  }
  store.drop();
  const org = joinedOrg(answer) ?? invite.org;
  return worldIn(await listWorlds(client, source).catch(() => []), org, invitedWorld(invite));
}

/** The name of the stored key the world last played is kept under (`Connection.scopedKey`). */
export const CURRENT_WORLD = "current-world";

/** The world last played, under a key scoped to the target and account (`Connection.scopedKey`). */
export function readCurrentWorld(storage: KeyValueStorage, key: string | null): World | null {
  if (!key) return null;
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && typeof (parsed as World).appId === "string") {
      const w = parsed as World;
      return { appId: w.appId, name: typeof w.name === "string" ? w.name : "", org: w.org ?? null };
    }
  } catch {
    /* nothing usable stored */
  }
  return null;
}

export function writeCurrentWorld(storage: KeyValueStorage, key: string | null, world: World | null): void {
  if (!key) return;
  try {
    if (world) storage.setItem(key, JSON.stringify(world));
    else storage.removeItem(key);
  } catch {
    /* remembered for this page only */
  }
}
