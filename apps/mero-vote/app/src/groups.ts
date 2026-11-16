import type { AppInfo } from "@calimero-network/mero-js";
import {
  appTarget,
  createInviteStore,
  INVITE_PARAMS,
  listAppInfos,
  targetKey,
  type AppSource,
  type ClientRoutes,
  type InviteStore,
  type KeyValueStorage,
  type Target,
} from "@calimero-apps/connect";

import { APP } from "./session";

/**
 * A voting group is an app instance (v1's context) in an organization of its own (v1's
 * namespace), whose members reach it; an invitation is an org invite.
 */

/** The voting groups this account reaches: instances of the dev bundle, or of the package. */
export async function listGroups(client: ClientRoutes<{ apps: "list" }>, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps = await listAppInfos(client, filter);
  return [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/** A new voting group's app instance, in the organization the node approved for it. Answers the instance's id and its org. */
export async function createGroup(
  client: ClientRoutes<{ apps: "create" }>,
  source: AppSource,
  name: string,
  org: string,
): Promise<{ appId: string; org: string }> {
  const appId = (await client.apps.create({ name, ...appTarget(source), org })).appId;
  return { appId, org };
}

/**
 * This app's pending invite (`createInviteStore` in `@calimero-apps/connect`):
 * captured in `main.tsx` before React mounts, then bound to the cluster, held
 * for the account that signs in with it and dropped on sign-out by the
 * passkey session (`usePasskeySession({ invites })`).
 */
export const invites: InviteStore = createInviteStore(APP);

/**
 * The page an invite link opens: this page's own path (the served
 * `/{version}/`), naming `org` so the dialog can tell a member.
 * The shared dialog adds the token. Pinned here until every cluster keeps the
 * query on its root redirect (core's served-redirect fix).
 */
export function inviteBase(org: string): string {
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set(INVITE_PARAMS.org, org);
  return url.toString();
}

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
 * The group to open in `org` (the one an invite joined, or the account was
 * already in): `prefer` (the one opened last) when it is in `org`, else the
 * first by name. `null` when the account reaches none there yet.
 */
export function instanceIn(apps: AppInfo[], org: string, prefer?: string | null): AppInfo | null {
  const inOrg = apps.filter((a) => a.org === org);
  return inOrg.find((a) => a.appId === prefer) ?? inOrg[0] ?? null;
}

/** The voting group last opened on this target by this account, remembered across loads. */
export function selectionKey(target: Target, accountId: string): string {
  return `${APP}:group:${targetKey(target)}:${accountId}`;
}
