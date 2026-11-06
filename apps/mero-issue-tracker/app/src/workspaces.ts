import { ORG_CAPABILITIES, type AppInfo, type CalimeroClient, type PasskeyProvider } from '@calimero-network/mero-js';
import type { AppSource, KeyValueStorage } from '@calimero-apps/connect';

import { APP_NAME } from './config';
import { tracker } from './tracker';

/**
 * v1 → Calimero 1.0, for this app:
 *
 * | v1 | here |
 * |---|---|
 * | a workspace: a namespace of the app | an **organization** (`createOrg`) |
 * | a repo: a context in the namespace (`serviceName: issue-tracker`) | an **app instance** in the org (`createApp(name, source, { org })`) |
 * | the repo name: the context's name | the instance's `name` |
 * | a namespace invitation (signed payload in a deflate+base58 link) | an **org invite** token in `?invite=` (`invite` is a passkey step-up; `redeemInvite` after sign-in) |
 * | member aliases: namespace member metadata | org **member metadata** `{ name }` |
 * | `Admin` / `Member` + capability bits | org roles `owner`/`admin`/`member`/`guest` + the same capability bits |
 */

/** A workspace this account is in. */
export interface Workspace {
  /** The org id. Named for what the screens called it. */
  namespaceId: string;
  name: string;
  role: string;
}

/** A repository: an app instance of this app in the workspace's org. */
export interface RepoEntry {
  /** The app instance id. */
  contextId: string;
  name: string;
}

/** What `/me` answers about orgs. */
interface MeOrgs {
  orgs?: Array<{ orgId: string; name: string; role: string }>;
}

export async function listWorkspaces(client: Pick<CalimeroClient, 'me'>): Promise<Workspace[]> {
  const me = (await client.me()) as MeOrgs;
  return (me.orgs ?? [])
    .map((o) => ({ namespaceId: o.orgId, name: o.name, role: o.role }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.namespaceId.localeCompare(b.namespaceId));
}

/** The instances of this app (the dev bundle, or the package) in `org`, by name. */
export async function listRepos(
  client: Pick<CalimeroClient, 'listApps'>,
  source: AppSource,
  org: string,
): Promise<RepoEntry[]> {
  const filter = typeof source === 'string' ? { bundle: source } : { package: source.package };
  const apps: AppInfo[] = await client.listApps(filter);
  return apps
    .filter((a) => a.org === org)
    .map((a) => ({ contextId: a.appId, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.contextId.localeCompare(b.contextId));
}

/**
 * What a member may do unless an admin sets otherwise, as v1 set it at
 * creation: add repos and invite people (and join open teams, the node's own
 * default).
 */
export const MEMBER_DEFAULTS =
  ORG_CAPABILITIES.CREATE_APP | ORG_CAPABILITIES.INVITE_MEMBERS | ORG_CAPABILITIES.JOIN_OPEN_TEAMS;

export interface CreatedWorkspace {
  namespaceId: string;
  /** Set when the org exists but its member defaults could not be set (a cancelled passkey). */
  warning: string | null;
}

/**
 * A new workspace: an org, whose members may add repos and invite (the default
 * is a passkey step-up; refused, the org stays and the Members page offers it again).
 */
export async function createWorkspace(
  client: Pick<CalimeroClient, 'createOrg' | 'setCapabilities'>,
  name: string,
  passkey: () => PasskeyProvider,
): Promise<CreatedWorkspace> {
  const namespaceId = await client.createOrg(name);
  try {
    await client.setCapabilities(namespaceId, MEMBER_DEFAULTS, passkey());
    return { namespaceId, warning: null };
  } catch {
    return {
      namespaceId,
      warning:
        'The workspace was created, but people you invite will not be able to add repositories or invite others until an admin fixes the defaults on the Members page.',
    };
  }
}

/** A new repository in `org`, its URL set when given. Answers the instance id. */
export async function addRepo(
  client: Pick<CalimeroClient, 'createApp' | 'call' | 'view'>,
  source: AppSource,
  org: string,
  name: string,
  repoUrl: string,
  after: () => void = () => {},
): Promise<string> {
  const appId = await client.createApp(name, source, { org });
  if (repoUrl.trim()) await tracker(client, appId, after).setRepoUrl(repoUrl.trim());
  return appId;
}

// ── members ──────────────────────────────────────────────────────────────────

/** The parts of `GET /orgs/{org}` the screens read. */
export interface OrgMembers {
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> its display name, where one is set. */
  names: Map<string, string>;
  /** account -> its own capability mask, where one is set. */
  overrides: Map<string, number>;
  defaultCapabilities: number | null;
}

export async function readMembers(client: Pick<CalimeroClient, 'getOrg'>, org: string): Promise<OrgMembers> {
  const o = (await client.getOrg(org)) as Record<string, unknown>;
  const members = (o.members ?? {}) as Record<string, string>;
  const meta = (o.memberMetadata ?? {}) as Record<string, unknown>;
  const caps = (o.capabilities ?? {}) as Record<string, number>;
  const names = new Map<string, string>();
  for (const [account, value] of Object.entries(meta)) {
    const name = (value as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && name.trim()) names.set(account, name.trim());
  }
  return {
    roles: new Map(Object.entries(members)),
    names,
    overrides: new Map(Object.entries(caps)),
    defaultCapabilities: typeof o.defaultCapabilities === 'number' ? o.defaultCapabilities : null,
  };
}

// ── invitations ──────────────────────────────────────────────────────────────

/** An invitation into `org` as a member, approved with the inviter's passkey (412 step-up). */
export async function inviteToken(
  client: Pick<CalimeroClient, 'invite'>,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  const token = await client.invite(org, 'member', passkey);
  rememberMinted(token, org);
  return token;
}

/** The link that opens this frontend with `token` to redeem. */
export function inviteLink(token: string, location: Pick<Location, 'origin' | 'pathname'> = window.location): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('invite', token);
  return url.toString();
}

const PENDING = `${APP_NAME}:pending-invite`;

/**
 * Takes `?invite=` off the address bar into storage, before anything renders: a
 * person opening a link is usually not signed in yet, and the token must
 * survive the sign-up. Redeemed (and dropped) once a session exists.
 */
export function captureInvite(storage: KeyValueStorage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get('invite');
  if (!token) return;
  try {
    storage.setItem(PENDING, token);
  } catch {
    return;
  }
  url.searchParams.delete('invite');
  window.history.replaceState(null, '', url.toString());
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

const MINTED = `${APP_NAME}:minted-invites`;
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
    const parsed: unknown = JSON.parse(storage.getItem(MINTED) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((e): e is [string, string] => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'string')
      : [];
  } catch {
    return [];
  }
}

/** What a refused redemption (an unknown, used, expired or revoked invite) tells the person. */
export const INVITE_SPENT = 'This invite was already used or has expired. Ask the person who invited you for a new link.';

/**
 * Whether the node refused the invite itself (a 4xx), as opposed to being
 * unreachable. Only a refusal drops the token: a network failure keeps it.
 */
export function inviteRefused(e: unknown): boolean {
  const status = (e as { status?: unknown } | null)?.status;
  return typeof status === 'number' && status >= 400 && status < 500;
}

/** The org an invitation redeemed into, from whichever field the node named it. */
export function joinedOrg(redeemed: Record<string, unknown>): string | null {
  for (const key of ['org', 'orgId']) {
    const v = redeemed[key];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}
