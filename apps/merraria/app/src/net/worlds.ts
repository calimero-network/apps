// Worlds, invitations and the world last played.
//
// A world is an app instance (v1: a context). Each world is created in an
// organization of its own (v1: a namespace), whose members reach it; an
// invitation is an org invite (v1: a namespace invitation), made with the
// inviter's passkey and redeemed by whoever opens the link, after signing in.

import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource, KeyValueStorage } from "@calimero-apps/connect";

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
  try {
    window.history.replaceState(null, "", url.toString());
  } catch {
    /* a sandboxed frame: the token is stored anyway */
  }
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
