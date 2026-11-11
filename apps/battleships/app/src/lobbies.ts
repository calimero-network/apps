import { passkeyConfirm, type AppInfo, type PasskeyProvider } from '@calimero-network/mero-js';
import {
  appTarget,
  createInviteStore,
  inviteLink,
  listAppInfos,
  type AppSource,
  type ClientRoutes,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
} from '@calimero-apps/connect';
import { nodeBasename } from '@calimero-apps/node-served';

import { APP } from './session';

/**
 * A lobby is an app instance (v1's lobby context) in an organization of its
 * own (v1's namespace), whose members reach it; an invitation is an org
 * invite. Every match of the lobby is played inside that one instance, so
 * there is no context to create, join or wait for per match.
 */

/** The lobbies this account reaches: instances of the dev bundle, or of the package. */
export async function listLobbies(client: ClientRoutes<{ apps: 'list' }>, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === 'string' ? { bundle: source } : { package: source.package };
  const apps = await listAppInfos(client, filter);
  return [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/**
 * A new lobby named `name`: an organization for it first, so players can be
 * invited, then the app instance in it.
 */
export async function createLobby(
  client: ClientRoutes<{ apps: 'create'; orgs: 'create' }>,
  source: AppSource,
  name: string,
): Promise<{ appId: string; org: string }> {
  const org = (await client.orgs.create({ name })).orgId;
  const appId = (await client.apps.create({ name, ...appTarget(source), org })).appId;
  return { appId, org };
}

/** An org member as the lobby lists it. `role` is v1's `Admin` / `Member` wording. */
export interface LobbyMember {
  identity: string;
  role: string;
  name?: string;
}

const ROLE: Record<string, string> = { owner: 'Admin', admin: 'Admin', member: 'Member', guest: 'Guest' };

/**
 * Everyone in the lobby's organization, with the display name each set there
 * (org member metadata `{ name }`). Replaces v1's namespace member list and
 * `@calimero-apps/names`.
 */
export async function orgMembers(client: ClientRoutes<{ orgs: 'get' }>, org: string): Promise<LobbyMember[]> {
  const info = await client.orgs.get({ org });
  const members = (info.members ?? {}) as Record<string, string>;
  const metadata = (info.memberMetadata ?? {}) as Record<string, unknown>;
  return Object.entries(members)
    .map(([identity, role]) => {
      const meta = metadata[identity];
      const name =
        meta && typeof meta === 'object' && typeof (meta as { name?: unknown }).name === 'string'
          ? ((meta as { name: string }).name.trim() || undefined)
          : undefined;
      return { identity, role: ROLE[role] ?? role, name };
    })
    .sort((a, b) => a.identity.localeCompare(b.identity));
}

/** Set the caller's display name in the lobby's organization. */
export async function saveMemberName(
  client: ClientRoutes<{ orgs: 'memberMetadata' }>,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  await client.orgs.memberMetadata({ org, account, metadata: { name } });
}

/** An invitation into `org` as a member, approved with the inviter's passkey (412 step-up). */
export function inviteToken(
  client: ClientRoutes<{ orgs: 'inviteCreate' }>,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.orgs
    .inviteCreate({ org, role: 'member', teams: [] }, { confirm: passkeyConfirm(passkey) })
    .then((r) => r.token);
}

/**
 * Where this frontend's routes live: `/`, or under the node's `/{version}/`.
 * A version-pinned invite link's route is read relative to it.
 */
export const basename = (): string => nodeBasename(new URL(window.location.href), '/');

/** The link parameter naming the lobby an invite opens. */
const LOBBY_PARAM = 'lobby';
/** The link parameter naming who sent it: "Join {from}'s game as ...?". */
const FROM_PARAM = 'from';

/**
 * This app's pending invite (`createInviteStore` in `@calimero-apps/connect`),
 * with the lobby its link names (`&lobby=`) and who sent it (`&from=`):
 * captured in `index.tsx` before React mounts, then bound to the cluster, held
 * for the account that signs in with it and dropped on sign-out by the passkey
 * session (`usePasskeySession({ invites })`).
 */
export const invites: InviteStore = createInviteStore(APP, { keep: [LOBBY_PARAM, FROM_PARAM] });

/** The lobby a pending invite's link names, opened once it is redeemed. */
export function invitedLobby(invite: PendingInvite | null): string | null {
  return invite?.extra[LOBBY_PARAM] ?? null;
}

/** Who sent a pending invite, as their link names them; `null` for a link that does not. */
export function inviter(invite: PendingInvite | null): string | null {
  return invite?.extra[FROM_PARAM] ?? null;
}

/**
 * The link that opens this frontend with `token` to redeem and `lobby` to open
 * after. `org` names the organization the token admits to, so a player already
 * in it (the inviter opening their own link, say) is not made to spend the
 * token's single use; `from` is the inviter's name, for the question the
 * invitee is asked.
 *
 * Pinned to the router's basename (the served `/{version}/`) until every
 * cluster keeps the query on its root redirect (core's served-redirect fix).
 * `/` sends a signed-in player on to the lobby page.
 */
export function lobbyInviteLink(token: string, lobby: string, org: string, from?: string | null): string {
  return inviteLink(token, { org, root: basename(), extra: { [LOBBY_PARAM]: lobby, [FROM_PARAM]: from } });
}

/** The key this app kept its pending invite under before the shared store: `{ token, lobby, org }`. */
const LEGACY_INVITE = `${APP}:pending-invite`;

/**
 * Moves an invite stored by an older build of this app into `store`, unless
 * the store holds one already (a link opened just now wins), and forgets the
 * old key.
 */
export function migrateStoredInvite(
  store: InviteStore,
  storage: KeyValueStorage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  let raw: string | null;
  try {
    raw = storage.getItem(LEGACY_INVITE);
  } catch {
    return;
  }
  if (raw && !store.pending()) {
    try {
      const old = JSON.parse(raw) as { token?: unknown; lobby?: unknown; org?: unknown };
      if (typeof old.token === 'string' && old.token) {
        store.put({
          token: old.token,
          org: typeof old.org === 'string' && old.org ? old.org : null,
          team: null,
          doc: null,
          route: null,
          extra: typeof old.lobby === 'string' && old.lobby ? { [LOBBY_PARAM]: old.lobby } : {},
        });
      }
    } catch {
      /* not an invite */
    }
  }
  try {
    storage.removeItem(LEGACY_INVITE);
  } catch {
    /* nothing stored */
  }
}
