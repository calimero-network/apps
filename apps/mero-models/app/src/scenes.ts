import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import { targetKey, type AppSource, type KeyValueStorage, type Target } from "@calimero-apps/connect";

import { APP } from "./session";
import type { OpenedScene } from "./scene";

/**
 * A scene is an app instance (v1's context) in an organization (v1's
 * namespace), whose members reach every scene in it; an invitation is an org
 * invite, and one opens every scene in the studio.
 */

/** The scenes this account reaches: instances of the dev bundle, or of the package. */
export async function listScenes(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps = await client.listApps(filter);
  return [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/** The studios (organizations) the scenes this account reaches belong to, without repeats. */
export function studiosOf(scenes: AppInfo[]): string[] {
  return [...new Set(scenes.map((s) => s.org).filter((o): o is string => !!o))];
}

/**
 * A new scene. In `org` when given (a studio the person is in, so its members
 * reach it too); otherwise in a new organization of its own, so people can be
 * invited. Answers what the studio opens.
 */
export async function createScene(
  client: Pick<CalimeroClient, "createApp" | "createOrg">,
  source: AppSource,
  name: string,
  org: string | null = null,
): Promise<OpenedScene> {
  const sceneName = name.trim() || "Untitled scene";
  const inOrg = org ?? (await client.createOrg(sceneName));
  const appId = await client.createApp(sceneName, source, { org: inOrg });
  return { appId, name: sceneName, org: inOrg };
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

/** The scene last opened on this target by this account, remembered across loads. */
export function selectionKey(target: Target, accountId: string): string {
  return `${APP}:scene:${targetKey(target)}:${accountId}`;
}

export function readSelection(storage: KeyValueStorage, key: string): OpenedScene | null {
  try {
    const raw = storage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && typeof (parsed as OpenedScene).appId === "string") {
      const s = parsed as OpenedScene;
      return { appId: s.appId, name: typeof s.name === "string" ? s.name : "", org: s.org ?? null };
    }
  } catch {
    /* nothing usable stored */
  }
  return null;
}

export function writeSelection(storage: KeyValueStorage, key: string, scene: OpenedScene | null): void {
  try {
    if (scene) storage.setItem(key, JSON.stringify({ appId: scene.appId, name: scene.name, org: scene.org }));
    else storage.removeItem(key);
  } catch {
    /* remembered for this page only */
  }
}
