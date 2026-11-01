import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { targetKey, type AppSource, type KeyValueStorage, type Target } from "@calimero-apps/connect";

import { APP } from "./session";

/**
 * A team is an app instance (v1's context) in an organization of its own (v1's
 * namespace), whose members reach it; an invitation is an org invite.
 */

/** The teams this account reaches: instances of the dev bundle, or of the package. */
export async function listTeams(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps = await client.listApps(filter);
  return [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/**
 * A new team: an organization for it first, so teammates can be invited, then
 * the app instance in it. Answers the instance's id and its org.
 */
export async function createTeam(
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

/** The link that opens this frontend with `token` to redeem. */
export function inviteLink(token: string, location: Pick<Location, "origin" | "pathname"> = window.location): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
  return url.toString();
}

const PENDING = `${APP}:pending-invite`;

/**
 * Takes `?invite=` off the address bar into storage, before anything renders: a
 * person opening a link is usually not signed in yet, and the token must
 * survive the sign-up. Redeemed (and dropped) once a session exists.
 */
export function captureInvite(storage: KeyValueStorage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  try {
    storage.setItem(PENDING, token);
  } catch {
    return;
  }
  url.searchParams.delete("invite");
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): string | null {
  try {
    return storage.getItem(PENDING);
  } catch {
    return null;
  }
}

export function dropInvite(storage: KeyValueStorage = localStorage): void {
  try {
    storage.removeItem(PENDING);
  } catch {
    /* nothing stored */
  }
}

/** The team last opened on this target by this account, remembered across loads. */
export function selectionKey(target: Target, accountId: string): string {
  return `${APP}:team:${targetKey(target)}:${accountId}`;
}
