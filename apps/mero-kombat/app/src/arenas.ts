import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { targetKey, type AppSource, type KeyValueStorage, type Target } from "@calimero-apps/connect";

import { APP } from "./session";

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

/** The link that opens this frontend with `token` to redeem and `arena` to open after. */
export function inviteLink(
  token: string,
  arena: string,
  location: Pick<Location, "origin" | "pathname"> = window.location,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
  url.searchParams.set("arena", arena);
  return url.toString();
}

export interface PendingInvite {
  token: string;
  /** The arena the link was made in: opened once the invitation is redeemed. */
  arena: string | null;
}

const PENDING = `${APP}:pending-invite`;

/**
 * Takes `?invite=` (and `&arena=`) off the address bar into storage, before
 * anything renders: a person opening a link is usually not signed in yet, and
 * the token must survive the sign-up. Redeemed (and dropped) once a session
 * exists.
 */
export function captureInvite(storage: KeyValueStorage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  try {
    storage.setItem(PENDING, JSON.stringify({ token, arena: url.searchParams.get("arena") }));
  } catch {
    return;
  }
  url.searchParams.delete("invite");
  url.searchParams.delete("arena");
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): PendingInvite | null {
  try {
    const raw = storage.getItem(PENDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingInvite>;
    return typeof parsed.token === "string"
      ? { token: parsed.token, arena: typeof parsed.arena === "string" ? parsed.arena : null }
      : null;
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

/** The arena last opened on this target by this account, remembered across loads. */
export function selectionKey(target: Target, accountId: string): string {
  return `${APP}:arena:${targetKey(target)}:${accountId}`;
}
