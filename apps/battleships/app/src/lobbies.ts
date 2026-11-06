import { CalimeroError, type AppInfo, type CalimeroClient, type PasskeyProvider } from '@calimero-network/mero-js';
import { type AppSource, type KeyValueStorage } from '@calimero-apps/connect';

import { APP } from './session';

/**
 * A lobby is an app instance (v1's lobby context) in an organization of its
 * own (v1's namespace), whose members reach it; an invitation is an org
 * invite. Every match of the lobby is played inside that one instance, so
 * there is no context to create, join or wait for per match.
 */

/** The lobbies this account reaches: instances of the dev bundle, or of the package. */
export async function listLobbies(client: Pick<CalimeroClient, 'listApps'>, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === 'string' ? { bundle: source } : { package: source.package };
  const apps = await client.listApps(filter);
  return [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/**
 * A new lobby named `name`: an organization for it first, so players can be
 * invited, then the app instance in it.
 */
export async function createLobby(
  client: Pick<CalimeroClient, 'createApp' | 'createOrg'>,
  source: AppSource,
  name: string,
): Promise<{ appId: string; org: string }> {
  const org = await client.createOrg(name);
  const appId = await client.createApp(name, source, { org });
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
export async function orgMembers(client: Pick<CalimeroClient, 'getOrg'>, org: string): Promise<LobbyMember[]> {
  const info = await client.getOrg(org);
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
export function saveMemberName(
  client: Pick<CalimeroClient, 'setMemberMetadata'>,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  return client.setMemberMetadata(org, account, { name });
}

/** An invitation into `org` as a member, approved with the inviter's passkey (412 step-up). */
export function inviteToken(
  client: Pick<CalimeroClient, 'invite'>,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.invite(org, 'member', passkey);
}

/**
 * The link that opens this frontend with `token` to redeem and `lobby` to open
 * after. `org` names the organization the token admits to, so a player already
 * in it (the inviter opening their own link, say) is not made to spend the
 * token's single use.
 */
export function inviteLink(
  token: string,
  lobby: string,
  location: Pick<Location, 'origin' | 'pathname'> = window.location,
  org?: string | null,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('invite', token);
  url.searchParams.set('lobby', lobby);
  if (org) url.searchParams.set('org', org);
  return url.toString();
}

export interface PendingInvite {
  token: string;
  /** The lobby the link was made in: opened once the invitation is redeemed. */
  lobby: string | null;
  /** The organization the token admits to, when the link names it. */
  org: string | null;
}

const PENDING = `${APP}:pending-invite`;

/**
 * Takes `?invite=` (and `&lobby=`) off the address bar into storage, before
 * anything renders: a person opening a link is usually not signed in yet, and
 * the token must survive the sign-up. Redeemed (and dropped) once a session
 * exists.
 */
export function captureInvite(storage: KeyValueStorage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get('invite');
  if (!token) return;
  try {
    storage.setItem(
      PENDING,
      JSON.stringify({ token, lobby: url.searchParams.get('lobby'), org: url.searchParams.get('org') }),
    );
  } catch {
    return;
  }
  url.searchParams.delete('invite');
  url.searchParams.delete('lobby');
  url.searchParams.delete('org');
  window.history.replaceState(null, '', url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): PendingInvite | null {
  try {
    const raw = storage.getItem(PENDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingInvite>;
    return typeof parsed.token === 'string'
      ? {
          token: parsed.token,
          lobby: typeof parsed.lobby === 'string' ? parsed.lobby : null,
          org: typeof parsed.org === 'string' ? parsed.org : null,
        }
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

/**
 * What to say when the node refused an invitation: it is unknown, already
 * used, expired or revoked. A 4xx can never succeed on retry, so the caller
 * drops the token; anything else (the cluster unreachable) is kept.
 */
export const INVITE_REFUSED = 'This invite was already used or has expired. Ask the person who invited you for a new link.';

/** True when `e` is the node refusing the invitation itself (see `INVITE_REFUSED`). */
export function inviteRefused(e: unknown): boolean {
  return e instanceof CalimeroError && e.status >= 400 && e.status < 500;
}

/**
 * Whether this account is already in the organization an invitation admits
 * to: `true` or `false` when the link names it, `null` when it cannot be told
 * (an older link). Redeeming as an existing member spends the token's single
 * use, which then leaves the player it was meant for unable to join.
 */
export async function alreadyMember(
  client: Pick<CalimeroClient, 'me'>,
  invite: PendingInvite,
): Promise<boolean | null> {
  if (!invite.org) return null;
  try {
    const me = (await client.me()) as { orgs?: Array<{ orgId?: unknown }> };
    return (me.orgs ?? []).some((o) => o.orgId === invite.org);
  } catch {
    return null;
  }
}
