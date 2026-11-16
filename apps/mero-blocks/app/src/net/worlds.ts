// Worlds, invitations and the world last played: v1's contexts are app
// instances, v1's namespaces are organizations, v1's namespace invitations are
// org invites.
//
// Every world gets an organization of its own, so its creator can invite
// friends: an invite is an org membership, made and redeemed through the
// shared dialogs (`ui/inviteDialogs.tsx`) and carried in a link to this frontend.

import type { AppInfo } from "@calimero-network/mero-js";
import {
  appSource,
  appTarget,
  createInviteStore,
  INVITE_PARAMS,
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

/** A new world: the instance in `org` (made by the node for it), with the world's `init` arguments. */
export async function createWorld(
  client: ClientRoutes<{ apps: "create" }>,
  source: AppSource,
  name: string,
  seed: number,
  org: string,
  nowSecs: number = Math.floor(Date.now() / 1000),
): Promise<CreatedWorld> {
  const appId = (await client.apps.create({ name, ...appTarget(source), org, initArgs: initArgs(name, seed, nowSecs) }))
    .appId;
  return { appId, org, name };
}

/** The link parameter naming the world an invite opens. */
const WORLD_PARAM = "world";

/**
 * This game's pending invite (`createInviteStore` in `@calimero-apps/connect`),
 * with the world its link names (`&world=`).
 * Captured in `main.ts` before anything renders; the launcher binds it to the
 * cluster, holds it for the account that signs in (another account's sign-in
 * drops it) and drops it on sign-out (`ui/landing.ts`).
 */
export const invites: InviteStore = createInviteStore(APP, { keep: [WORLD_PARAM] });

/** The world a pending invite's link names. */
export function invitedWorld(invite: PendingInvite | null): string | null {
  return invite?.extra[WORLD_PARAM] ?? null;
}

/** Where this frontend is served: `/`, or the node's `/{version}/`. */
export const basename = (): string => nodeBasename(new URL(window.location.href), "/");

/**
 * The page an invite link opens (`InviteDialog`'s `linkBase`): this frontend,
 * naming `org` and the `world` to enter. Without `org` the launcher cannot tell
 * an invitation into a world the player is already in, and redeeming that
 * spends the link's single use on nobody. Pinned to the served `/{version}/`
 * until every cluster keeps the query on its root redirect.
 */
export function worldLinkBase(org: string, world: string): string {
  const url = new URL(basename(), window.location.origin);
  url.searchParams.set(INVITE_PARAMS.org, org);
  url.searchParams.set(WORLD_PARAM, world);
  return url.toString();
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
