import { ORG_CAPABILITIES, type AppInfo, type CalimeroClient, type PasskeyProvider } from '@calimero-network/mero-js';
import {
  createInviteStore,
  inviteLink as sharedInviteLink,
  type AppSource,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
} from '@calimero-apps/connect';
import { nodeBasename } from '@calimero-apps/node-served';

import { APP_NAME, APP_ROUTE } from './config';
import { crm } from './crm';

/**
 * v1 → Calimero 1.0, for this app:
 *
 * | v1 | here |
 * |---|---|
 * | a workspace: a namespace of the app | an **organization** (`createOrg`) |
 * | a pipeline: a context in the namespace (`serviceName: crm`) | an **app instance** in the org (`createApp(name, source, { org })`) |
 * | the pipeline name: the context's name | the instance's `name` |
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

/** A pipeline: an app instance of this app in the workspace's org. */
export interface PipelineEntry {
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
export async function listPipelines(
  client: Pick<CalimeroClient, 'listApps'>,
  source: AppSource,
  org: string,
): Promise<PipelineEntry[]> {
  const filter = typeof source === 'string' ? { bundle: source } : { package: source.package };
  const apps: AppInfo[] = await client.listApps(filter);
  return apps
    .filter((a) => a.org === org)
    .map((a) => ({ contextId: a.appId, name: a.name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.contextId.localeCompare(b.contextId));
}

/**
 * What a member may do unless an admin sets otherwise, as v1 set it at
 * creation: add pipelines and invite people (and join open teams, the node's own
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
 * A new workspace: an org, whose members may add pipelines and invite (the default
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
        'The workspace was created, but people you invite will not be able to add pipelines or invite others until an admin fixes the defaults on the Members page.',
    };
  }
}

/**
 * A new pipeline in `org`. It starts in USD; another currency is written into
 * its settings right after, best-effort, as v1 did: Settings can change it
 * later, and a currency is not worth failing an otherwise-created pipeline
 * over. Answers the instance id.
 */
export async function addPipeline(
  client: Pick<CalimeroClient, 'createApp' | 'call' | 'view'>,
  source: AppSource,
  org: string,
  name: string,
  currency: string,
  after: () => void = () => {},
): Promise<string> {
  const appId = await client.createApp(name, source, { org });
  const code = currency.trim().toUpperCase();
  if (code && code !== 'USD') {
    try {
      await crm(client, appId, after).setCurrency({ currency: code });
    } catch {
      /* stays USD until changed in Settings */
    }
  }
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
export function inviteToken(
  client: Pick<CalimeroClient, 'invite'>,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.invite(org, 'member', passkey);
}

/**
 * The link that opens this frontend with `token` to redeem, and the page it
 * was made on (its route, relative to the router's basename). It also names
 * `org`: the token does not say which org it is for until it is redeemed, and
 * redeeming spends it, so the link carries the org for the app to tell an
 * existing member "you are already in" without spending a use.
 *
 * The link stays under the served `/{version}/` root until every cluster's
 * served-host redirect keeps the query string (core's served-redirect fix).
 */
export function inviteLink(
  token: string,
  org?: string,
  location: Pick<Location, 'href'> = window.location,
): string {
  const url = new URL(location.href);
  const root = nodeBasename(url, '/');
  const route = url.pathname.startsWith(root) ? `/${url.pathname.slice(root.length)}` : url.pathname;
  return sharedInviteLink(token, { org, route, root, origin: url.origin });
}

/** This app's pending invite (`@calimero-apps/connect`), captured in `index.tsx` before React mounts. */
export const invites = createInviteStore(APP_NAME);

const LEGACY_PENDING = `${APP_NAME}:pending-invite`;
const LEGACY_ORG = `${APP_NAME}:pending-invite-org`;
const LEGACY_ROUTE = `${APP_NAME}:pending-invite-route`;

/**
 * Moves an invite an earlier build stored under its own keys into the shared
 * store, so a link opened before the upgrade still joins after it.
 */
export function migrateLegacyInvite(storage: KeyValueStorage = localStorage, store: InviteStore = invites): void {
  try {
    const token = storage.getItem(LEGACY_PENDING);
    if (token) {
      store.put({
        token,
        org: storage.getItem(LEGACY_ORG),
        team: null,
        doc: null,
        route: storage.getItem(LEGACY_ROUTE),
        extra: {},
      });
    }
    for (const key of [LEGACY_PENDING, LEGACY_ORG, LEGACY_ROUTE]) storage.removeItem(key);
  } catch {
    /* storage unavailable: nothing was stored */
  }
}

/**
 * Where to go once the invitation is accepted: the route the link opened when
 * that is inside the CRM, else the CRM's start.
 */
export function inviteRoute(invite: Pick<PendingInvite, 'route'> | null): string {
  const route = invite?.route ?? null;
  return route && (route === APP_ROUTE || route.startsWith(`${APP_ROUTE}/`)) ? route : APP_ROUTE;
}

