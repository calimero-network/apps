import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import {
  createInviteStore,
  targetKey,
  type AppSource,
  type InviteStore,
  type KeyValueStorage,
  type Target,
} from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";

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

/**
 * This app's pending invite (`createInviteStore` in `@calimero-apps/connect`):
 * captured in `main.tsx` before React mounts, then bound to the cluster, held
 * for the account that signs in with it and dropped on sign-out by the
 * passkey session (`usePasskeySession({ invites })`).
 */
export const invites: InviteStore = createInviteStore(APP);

/**
 * Where this frontend's routes live: `/`, or under the node's `/{version}/`.
 * A version-pinned invite link's route is read relative to it.
 */
export const basename = (): string => nodeBasename(new URL(window.location.href), "/");

/**
 * Where a minted invite link opens: the router's basename, the served
 * `/{version}/`. `inviteLink` defaults to the origin's root, which a cluster
 * redirects to the newest release only with core's served-redirect fix (it
 * keeps the query); until every cluster runs it, the link stays pinned here.
 * The landing page sends an invited visitor on into the studio.
 */
export const inviteRoot = basename;

/** The keys this app kept its pending invite under before the shared store. */
const LEGACY_INVITE = [`${APP}:pending-invite`, `${APP}:pending-invite-org`] as const;

/**
 * Moves an invite stored by an older build of this app (`<app>:pending-invite`
 * and its `-org`) into `store`, unless the store holds one already (a link
 * opened just now wins), and forgets the old keys.
 */
export function migrateStoredInvite(
  store: InviteStore,
  storage: KeyValueStorage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  let token: string | null;
  let org: string | null;
  try {
    token = storage.getItem(LEGACY_INVITE[0]);
    org = storage.getItem(LEGACY_INVITE[1]);
  } catch {
    return;
  }
  if (token && !store.pending()) {
    store.put({ token, org: org || null, team: null, doc: null, route: null, extra: {} });
  }
  for (const key of LEGACY_INVITE) {
    try {
      storage.removeItem(key);
    } catch {
      /* nothing stored */
    }
  }
}

/**
 * The scene to open in `org` (the one an invite joined, or the account was
 * already in): `prefer` (the one opened last) when it is in `org`, else the
 * first by name. `null` when the account reaches none there yet.
 */
export function instanceIn(apps: AppInfo[], org: string, prefer?: string | null): AppInfo | null {
  const inOrg = apps.filter((a) => a.org === org);
  return inOrg.find((a) => a.appId === prefer) ?? inOrg[0] ?? null;
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
