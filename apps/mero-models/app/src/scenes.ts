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
