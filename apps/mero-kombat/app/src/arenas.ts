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
export async function inviteToken(
  client: Pick<CalimeroClient, "invite">,
  org: string,
  passkey: PasskeyProvider,
  storage: KeyValueStorage = localStorage,
): Promise<string> {
  const token = await client.invite(org, "member", passkey);
  rememberMinted(token, org, storage);
  return token;
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

const MINTED = `${APP}:minted-invites`;
const MINTED_KEEP = 20;

/**
 * Which org each invite this browser minted points at. A token is opaque, so
 * this is the only way to know an invite's org before spending it: an owner
 * who opens their own link to check it would otherwise redeem its single use
 * and leave the person it was meant for with "unknown invite".
 */
export function rememberMinted(token: string, org: string, storage: KeyValueStorage = localStorage): void {
  try {
    const all = readMinted(storage).filter(([t]) => t !== token);
    all.push([token, org]);
    storage.setItem(MINTED, JSON.stringify(all.slice(-MINTED_KEEP)));
  } catch {
    /* storage unavailable: the prompt simply stays */
  }
}

/** The org `token` points at, when this browser minted it; otherwise unknown. */
export function mintedOrg(token: string, storage: KeyValueStorage = localStorage): string | null {
  return readMinted(storage).find(([t]) => t === token)?.[1] ?? null;
}

function readMinted(storage: KeyValueStorage): Array<[string, string]> {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(MINTED) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === "string" && typeof e[1] === "string")
      : [];
  } catch {
    return [];
  }
}

/** Whether `client` is already in `org`; null when that cannot be told. */
export async function memberOf(client: Pick<CalimeroClient, "me">, org: string): Promise<boolean | null> {
  try {
    const me = (await client.me()) as { orgs?: Array<{ orgId?: string }> };
    return Array.isArray(me.orgs) ? me.orgs.some((o) => o.orgId === org) : null;
  } catch {
    return null;
  }
}

/** What a refused redemption (an unknown, used, expired or revoked invite) tells the person. */
export const INVITE_SPENT = "This invite was already used or has expired. Ask the person who invited you for a new link.";

/**
 * Whether the node refused the invite itself (a 4xx), as opposed to being
 * unreachable. Only a refusal drops the token: a network failure keeps it.
 */
export function inviteRefused(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status < 500;
}

/** The arena last opened on this target by this account, remembered across loads. */
export function selectionKey(target: Target, accountId: string): string {
  return `${APP}:arena:${targetKey(target)}:${accountId}`;
}
