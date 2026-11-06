import { CalimeroError, type AppInfo, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import { targetKey, type AppSource, type KeyValueStorage, type Target } from "@calimero-apps/connect";

import { APP } from "./session";

/**
 * A voting group is an app instance (v1's context) in an organization of its own (v1's
 * namespace), whose members reach it; an invitation is an org invite.
 */

/** The voting groups this account reaches: instances of the dev bundle, or of the package. */
export async function listGroups(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps = await client.listApps(filter);
  return [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/**
 * A new voting group: an organization for it first, so members can be invited, then
 * the app instance in it. Answers the instance's id and its org.
 */
export async function createGroup(
  client: Pick<CalimeroClient, "createApp" | "createOrg">,
  source: AppSource,
  name: string,
): Promise<{ appId: string; org: string }> {
  const org = await client.createOrg(name);
  const appId = await client.createApp(name, source, { org });
  return { appId, org };
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
 * The link that opens this frontend with `token` to redeem. It also names
 * `org`: the token does not say which org it is for until it is redeemed, and
 * redeeming spends one of its uses even for someone already in the org, so the
 * link carries it for the app to tell a member "you are already in" first.
 */
export function inviteLink(
  token: string,
  location: Pick<Location, "origin" | "pathname"> = window.location,
  org?: string,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
  if (org) url.searchParams.set("org", org);
  return url.toString();
}

const PENDING = `${APP}:pending-invite`;
const PENDING_ORG = `${APP}:pending-invite-org`;

/**
 * Takes `?invite=` off the address bar into storage, before anything renders: a
 * person opening a link is usually not signed in yet, and the token must
 * survive the sign-up. Redeemed (and dropped) once a session exists.
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

/** The org the pending invitation's link named, when it named one. */
export function pendingInviteOrg(storage: KeyValueStorage = localStorage): string | null {
  try {
    return storage.getItem(PENDING_ORG);
  } catch {
    return null;
  }
}

export function dropInvite(storage: KeyValueStorage = localStorage): void {
  for (const key of [PENDING, PENDING_ORG]) {
    try {
      storage.removeItem(key);
    } catch {
      /* nothing stored */
    }
  }
}

/**
 * Whether a redemption failed because the invitation itself is spent: used,
 * expired, revoked or unknown to the node. Those answer a 4xx; a 5xx or a
 * network failure is worth retrying with the same token.
 */
export function isSpentInvite(e: unknown): boolean {
  return e instanceof CalimeroError && e.status >= 400 && e.status < 500 && e.status !== 401;
}

/** What the invitation screen says about a spent invitation. */
export const SPENT_INVITE = "This invite was already used or has expired. Ask the person who invited you for a new link.";

/** The voting group last opened on this target by this account, remembered across loads. */
export function selectionKey(target: Target, accountId: string): string {
  return `${APP}:group:${targetKey(target)}:${accountId}`;
}
