import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import {
  createInviteStore,
  targetKey,
  type AppSource,
  type InviteStore,
  type KeyValueStorage,
  type Target,
} from "@calimero-apps/connect";

import { APP } from "./session";

/**
 * A store is an app instance: v1's context. One made "shared" lives in an
 * organization of its own (v1's namespace), whose members reach it; an
 * invitation is an org invite.
 */

/** The instances of this app the account reaches: of the dev bundle, or of the package. */
export async function listStores(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps = await client.listApps(filter);
  return [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/**
 * A new store. `shared` creates an organization for it first, so members can be
 * invited; otherwise only this account reaches it.
 */
export async function createStore(
  client: Pick<CalimeroClient, "createApp" | "createOrg">,
  source: AppSource,
  name: string,
  shared: boolean,
): Promise<string> {
  const org = shared ? await client.createOrg(name) : undefined;
  return client.createApp(name, source, org ? { org } : {});
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
 * Where a minted invite link opens: this page's own path, the served
 * `/{version}/`. `inviteLink` defaults to the origin's root, which a cluster
 * redirects to the newest release only with core's served-redirect fix (it
 * keeps the query); until every cluster runs it, the link stays pinned here.
 */
export const inviteRoot = (): string => window.location.pathname;

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
 * The store to open in `org` (the one an invite joined, or the account was
 * already in): `prefer` (the one opened last) when it is in `org`, else the
 * first by name. `null` when the account reaches none there yet.
 */
export function instanceIn(apps: AppInfo[], org: string, prefer?: string | null): AppInfo | null {
  const inOrg = apps.filter((a) => a.org === org);
  return inOrg.find((a) => a.appId === prefer) ?? inOrg[0] ?? null;
}

/** The store last opened on this target by this account, remembered across loads. */
export function selectionKey(target: Target, accountId: string): string {
  return `${APP}:store:${targetKey(target)}:${accountId}`;
}
