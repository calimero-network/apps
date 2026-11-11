// Worlds, invitations and the world last played: v1's contexts are app
// instances, v1's namespaces are organizations, v1's namespace invitations are
// org invites.
//
// Every world gets an organization of its own, so its creator can invite
// friends: an invite is an org membership (`client.invite(org, "member",
// passkey)`, a passkey step-up for the inviter), carried in a link to this
// frontend and redeemed after the invitee signs in and says Join.

import { passkeyConfirm, type AppInfo, type PasskeyProvider } from "@calimero-network/mero-js";
import {
  appSource,
  appTarget,
  createInviteStore,
  inviteLink,
  isSpentInvite,
  joinedOrg,
  listAppInfos,
  targetKey,
  type AppSource,
  type ClientRoutes,
  type ConnectEnv,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
  type Target,
} from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";

import { PACKAGE, initArgs } from "./blocks";
import { APP } from "./session";

/** Where instances come from: the dev bundle (`dev:local`), else the package. */
export function worldSource(env: ConnectEnv): AppSource {
  return appSource(env, PACKAGE);
}

/** The worlds the account reaches: instances of the dev bundle, or of the package. */
export async function listWorlds(client: ClientRoutes<{ apps: "list" }>, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps = await listAppInfos(client, filter);
  return [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

export interface CreatedWorld {
  appId: string;
  org: string;
  name: string;
}

/** A new world: its organization, then the instance in it, with the world's `init` arguments. */
export async function createWorld(
  client: ClientRoutes<{ apps: "create"; orgs: "create" }>,
  source: AppSource,
  name: string,
  seed: number,
  nowSecs: number = Math.floor(Date.now() / 1000),
): Promise<CreatedWorld> {
  const org = (await client.orgs.create({ name })).orgId;
  const appId = (await client.apps.create({ name, ...appTarget(source), org, initArgs: initArgs(name, seed, nowSecs) }))
    .appId;
  return { appId, org, name };
}

/** An invitation into the world's org as a member, approved with the inviter's passkey (412 step-up). */
export function inviteToken(
  client: ClientRoutes<{ orgs: "inviteCreate" }>,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.orgs
    .inviteCreate({ org, role: "member", teams: [] }, { confirm: passkeyConfirm(passkey) })
    .then((r) => r.token);
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
 * The link that opens this frontend with `token` to redeem.
 *
 * `org` names the world's org. The token itself does not say, and without it
 * the launcher cannot tell an invitation into a world the player is already
 * in: redeeming that spends the link's single use on nobody. `world` is the
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
export function worldIn(worlds: AppInfo[], org: string | null, named?: string | null): AppInfo | null {
  const asked = named ? worlds.find((w) => w.appId === named) : undefined;
  if (asked) return asked;
  return org ? (worlds.find((w) => w.org === org) ?? null) : null;
}

/**
 * The world a pending invitation names, when this account already plays in
 * it: the token is then dropped UNSPENT. Redeeming it would spend the link's
 * single use on nobody, and leave the player it was meant for with "unknown
 * invite". `null` when the link names no org (or world) the account reaches.
 */
export async function alreadyInInvitedWorld(
  client: ClientRoutes<{ apps: "list" }>,
  source: AppSource,
  store: InviteStore = invites,
): Promise<AppInfo | null> {
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
 * good (`isSpentInvite`: unknown, used up, expired, its org gone). Anything
 * else (a lapsed session, a rate limit, the cluster or the network down)
 * keeps it for another try, and the error is thrown for the caller to say so
 * (`describeRedeemFailure`).
 */
export async function redeemPendingInvite(
  client: ClientRoutes<{ orgs: "inviteRedeem"; apps: "list" }>,
  source: AppSource,
  store: InviteStore = invites,
): Promise<AppInfo | null> {
  const invite = store.pending();
  if (!invite) return null;
  let answer: unknown;
  try {
    answer = await client.orgs.inviteRedeem({ token: invite.token });
  } catch (e) {
    if (isSpentInvite(e)) store.drop();
    throw e;
  }
  store.drop();
  const org = joinedOrg(answer) ?? invite.org;
  return worldIn(await listWorlds(client, source).catch(() => []), org, invitedWorld(invite));
}

/** `head…tail` of an account id, as the invitation question names the account that joins. */
export function shortAccount(id: string): string {
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}

/** Storage key of the world last played on this target by this account. */
export function selectionKey(target: Target, accountId: string): string {
  return `${APP}:world:${targetKey(target)}:${accountId}`;
}

export function rememberWorld(target: Target, accountId: string, appId: string, storage: KeyValueStorage = localStorage): void {
  try {
    storage.setItem(selectionKey(target, accountId), appId);
  } catch {
    /* not remembered: the picker lists it anyway */
  }
}

export function lastWorld(target: Target, accountId: string, storage: KeyValueStorage = localStorage): string | null {
  try {
    return storage.getItem(selectionKey(target, accountId));
  } catch {
    return null;
  }
}

export function forgetWorld(target: Target, accountId: string, storage: KeyValueStorage = localStorage): void {
  try {
    storage.removeItem(selectionKey(target, accountId));
  } catch {
    /* nothing stored */
  }
}
