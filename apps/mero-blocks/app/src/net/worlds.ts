// Worlds, invitations and the world last played: v1's contexts are app
// instances, v1's namespaces are organizations, v1's namespace invitations are
// org invites.
//
// Every world gets an organization of its own, so its creator can invite
// friends: an invite is an org membership (`client.invite(org, "member",
// passkey)`, a passkey step-up for the inviter), carried in a link to this
// frontend and redeemed after the invitee signs in.

import { CalimeroError, type AppInfo, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import {
  appSource,
  describeError,
  targetKey,
  type AppSource,
  type ConnectEnv,
  type KeyValueStorage,
  type Target,
} from "@calimero-apps/connect";

import { PACKAGE, initArgs } from "./blocks";
import { APP } from "./session";

/** Where instances come from: the dev bundle (`dev:local`), else the package. */
export function worldSource(env: ConnectEnv): AppSource {
  return appSource(env, PACKAGE);
}

/** The worlds the account reaches: instances of the dev bundle, or of the package. */
export async function listWorlds(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps = await client.listApps(filter);
  return [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

export interface CreatedWorld {
  appId: string;
  org: string;
  name: string;
}

/** A new world: its organization, then the instance in it, with the world's `init` arguments. */
export async function createWorld(
  client: Pick<CalimeroClient, "createApp" | "createOrg">,
  source: AppSource,
  name: string,
  seed: number,
  nowSecs: number = Math.floor(Date.now() / 1000),
): Promise<CreatedWorld> {
  const org = await client.createOrg(name);
  const appId = await client.createApp(name, source, { org, initArgs: initArgs(name, seed, nowSecs) });
  return { appId, org, name };
}

/** An invitation into the world's org as a member, approved with the inviter's passkey (412 step-up). */
export function inviteToken(client: Pick<CalimeroClient, "invite">, org: string, passkey: PasskeyProvider): Promise<string> {
  return client.invite(org, "member", passkey);
}

/**
 * The link that opens this frontend with `token` to redeem.
 *
 * `org` names the world's org. The token itself does not say, and without it
 * the launcher cannot tell an invitation into a world the player is already
 * in: redeeming that spends the link's single use on nobody.
 */
export function inviteLink(
  token: string,
  location: Pick<Location, "origin" | "pathname"> = window.location,
  org?: string | null,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
  if (org) url.searchParams.set("org", org);
  return url.toString();
}

const PENDING = `${APP}:pending-invite`;
const PENDING_ORG = `${APP}:pending-invite-org`;

/**
 * Takes `?invite=` off the address bar into storage, before anything renders:
 * a person opening a link is usually not signed in yet, and the token must
 * survive the passkey sign-up. Redeemed (and dropped) once a session exists.
 */
export function captureInvite(storage: KeyValueStorage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  const org = url.searchParams.get("org");
  try {
    storage.setItem(PENDING, token);
    if (org) storage.setItem(PENDING_ORG, org);
    else storage.removeItem(PENDING_ORG);
  } catch {
    return;
  }
  url.searchParams.delete("invite");
  url.searchParams.delete("org");
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): string | null {
  try {
    return storage.getItem(PENDING);
  } catch {
    return null;
  }
}

/** The org a pending invitation's link named (`&org=`), when it named one. */
export function pendingInviteOrg(storage: KeyValueStorage = localStorage): string | null {
  try {
    return storage.getItem(PENDING_ORG) || null;
  } catch {
    return null;
  }
}

export function dropInvite(storage: KeyValueStorage = localStorage): void {
  try {
    storage.removeItem(PENDING);
    storage.removeItem(PENDING_ORG);
  } catch {
    /* nothing stored */
  }
}

/** What to say when a token is refused for good. */
export const SPENT_INVITE = "This invite was already used or has expired. Ask the person who invited you for a new link.";

/** The plain sentence for a failed redemption: refused for good (a 4xx), or not reached. */
export function inviteFailure(e: unknown): string {
  const refused =
    e instanceof CalimeroError
      ? e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429
      : /unknown invite|already used|expired|revoked/i.test(describeError(e));
  return refused ? SPENT_INVITE : `Could not accept the invitation: ${describeError(e)}`;
}

/**
 * The world a pending invitation names, when this account already plays in
 * it: the token is then dropped UNSPENT. Redeeming it would spend the link's
 * single use on nobody, and leave the player it was meant for with "unknown
 * invite". `null` when the link names no org or the account is not in it.
 */
export async function alreadyInInvitedWorld(
  client: Pick<CalimeroClient, "listApps">,
  source: AppSource,
  storage: KeyValueStorage = localStorage,
): Promise<AppInfo | null> {
  const org = pendingInvite(storage) ? pendingInviteOrg(storage) : null;
  if (!org) return null;
  const world = (await listWorlds(client, source).catch(() => [])).find((w) => w.org === org) ?? null;
  if (world) dropInvite(storage);
  return world;
}

/**
 * Redeem the pending invitation, if any, and answer the world it opens: the
 * first world in the org the invite joined. `null` when there is no invite, or
 * the org holds no world this frontend plays. The token is dropped either way
 * once the node has answered (a used or expired token never works again).
 */
export async function redeemPendingInvite(
  client: Pick<CalimeroClient, "redeemInvite" | "listApps">,
  source: AppSource,
  storage: KeyValueStorage = localStorage,
): Promise<AppInfo | null> {
  const token = pendingInvite(storage);
  if (!token) return null;
  let org: string | undefined;
  try {
    const answer = await client.redeemInvite(token);
    org = typeof answer.org === "string" ? answer.org : typeof answer.orgId === "string" ? answer.orgId : undefined;
  } finally {
    dropInvite(storage);
  }
  const worlds = await listWorlds(client, source);
  return worlds.find((w) => org !== undefined && w.org === org) ?? null;
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
