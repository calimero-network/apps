import { ORG_CAPABILITIES, type AppInfo, type CalimeroClient, type PasskeyProvider } from '@calimero-network/mero-js';
import {
  appInvite,
  appPeople,
  appTarget,
  createAppOrg,
  createInviteStore,
  inviteLink as sharedInviteLink,
  isAppOnly,
  leaveApp,
  leaveOrg,
  listAppInfos,
  orgInstanceOptions,
  orgsWithApp,
  sourcePackage,
  type AppInviteToken,
  type AppOrgView,
  type AppSource,
  type ClientRoutes,
  type InviteStore,
  type KeyValueStorage,
  type LeftApp,
  type PendingInvite,
} from '@calimero-apps/connect';
import { nodeBasename } from '@calimero-apps/node-served';

import { APP_NAME, APP_ROUTE, PRODUCT_NAME } from './config';
import { tracker } from './tracker';

/**
 * v1 → Calimero 1.0, for this app:
 *
 * | v1 | here |
 * |---|---|
 * | a workspace: a namespace of the app | an **organization** (`createOrg`) |
 * | a repo: a context in the namespace (`serviceName: issue-tracker`) | an **app instance** in the org (`createApp(name, source, { org })`) |
 * | the repo name: the context's name | the instance's `name` |
 * | a namespace invitation (signed payload in a deflate+base58 link) | an **org invite** token in `?invite=` naming this app's team (`appInvite`, a passkey step-up; `redeemInvite` after sign-in) |
 * | member aliases: namespace member metadata | org **member metadata** `{ name }` |
 * | `Admin` / `Member` + capability bits | org roles `owner`/`admin`/`member`/`guest` + the same capability bits |
 *
 * The org gets this app's own **app team** (core#4890), through
 * `@calimero-apps/connect`'s org-app module: a new workspace's team is open
 * (everyone in the org has the app), instances use team access on it,
 * invites name it, and the member list is its people. Once an admin keeps
 * the org's apps apart in Calimero Home (`shared`), an invite gives this app
 * only and Remove takes someone out of this app, not out of the org. An org
 * without one (made before app teams, a node without them, a raw dev bundle)
 * is legacy: organization access, as before.
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

/**
 * The workspaces: the orgs this account is in that hold repositories or were made
 * for this app. An org made for another app (a Mero Blocks world) is offered
 * only under "Connect to an existing organization" (`otherOrgs`).
 */
export async function listWorkspaces(
  client: ClientRoutes<{ auth: 'me'; apps: 'list'; orgs: 'get' }>,
  source: AppSource,
): Promise<Workspace[]> {
  return (await orgsWithApp(client, source, { marked: true }))
    .map((o) => ({ namespaceId: o.orgId, name: o.name, role: o.role }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.namespaceId.localeCompare(b.namespaceId));
}

/** The instances of this app (the dev bundle, or the package) in `org`, by name. */
export async function listRepos(
  client: ClientRoutes<{ apps: 'list' }>,
  source: AppSource,
  org: string,
): Promise<RepoEntry[]> {
  const filter = typeof source === 'string' ? { bundle: source } : { package: source.package };
  const apps: AppInfo[] = await listAppInfos(client, filter);
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
  client: ClientRoutes<{ orgs: 'create' | 'capabilities' | 'get' | 'metadata' | 'appTeamsScope' }>,
  name: string,
  passkey: () => PasskeyProvider,
  source?: AppSource,
): Promise<CreatedWorkspace> {
  // The org, marked so it is listed before it holds repositories, and this app's
  // own team, open (declined, or an older node: a legacy org). Declined member
  // defaults leave the org too, and the Members page offers them again.
  const made = await createAppOrg(client, name, source, passkey, { capabilities: MEMBER_DEFAULTS });
  return {
    namespaceId: made.orgId,
    warning: made.capabilitiesError
      ? 'The workspace was created, but people you invite will not be able to add repositories or invite others until an admin fixes the defaults on the Members page.'
      : null,
  };
}

/** A new repository in `org`, its URL set when given. Answers the instance id. */
export async function addRepo(
  client: Pick<CalimeroClient, 'session'> &
    ClientRoutes<{ apps: 'create' | 'call' | 'view'; orgs: 'get' | 'appTeamsScope' }>,
  source: AppSource,
  org: string,
  name: string,
  repoUrl: string,
  passkey: () => PasskeyProvider,
  after: () => void = () => {},
): Promise<string> {
  // On this app's team (`orgWideAccess`): made first, by an owner or admin,
  // in an org whose other apps have teams; organization access in a legacy org.
  const appId = (
    await client.apps.create({
      name,
      ...appTarget(source),
      ...(await orgInstanceOptions(client, org, source, passkey, PRODUCT_NAME)),
    })
  ).appId;
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
  /**
   * Who has this app in the org, in org order: its app team's people; without
   * one, every member (no guest once the org has app teams). `roles` keeps
   * the whole org, which the role checks read.
   */
  people: string[];
  /** The org keeps its apps apart and this one has its team: invites and Remove are this app's only. */
  appOnly: boolean;
}

export async function readMembers(
  client: ClientRoutes<{ orgs: 'get' }>,
  org: string,
  source: AppSource | null = null,
): Promise<OrgMembers> {
  const o = (await client.orgs.get({ org })) as Record<string, unknown>;
  const view = o as AppOrgView;
  const pkg = sourcePackage(source);
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
    people: appPeople(view, pkg),
    appOnly: isAppOnly(view, pkg),
  };
}

/**
 * The signed-in account leaves the workspace (`leaveApp`, a passkey step-up).
 * In an org that keeps its apps apart that is Mero Issue Tracker only, with
 * `lastApp` set when it was their last app there (offer
 * {@link leaveWorkspaceOrg}); elsewhere it is the organization, as before.
 */
export function leaveWorkspace(
  client: Pick<CalimeroClient, 'session'> &
    ClientRoutes<{ orgs: 'get' | 'appTeamList' | 'teamRemoveMember' | 'removeMember' }>,
  org: string,
  source: AppSource | null,
  passkey: () => PasskeyProvider,
  self?: string,
): Promise<LeftApp> {
  return leaveApp(client, org, source, passkey, self ? { self } : {});
}

/** The signed-in account leaves the organization altogether, every app in it. A passkey step-up. */
export function leaveWorkspaceOrg(
  client: Pick<CalimeroClient, 'session'> & ClientRoutes<{ orgs: 'removeMember' }>,
  org: string,
  passkey: () => PasskeyProvider,
  self?: string,
): Promise<void> {
  return leaveOrg(client, org, passkey, self);
}

// ── invitations ──────────────────────────────────────────────────────────────

/**
 * An invitation into `org` as a member, approved with the inviter's passkey
 * (412 step-up), naming this app's team (`appInvite`): in an org that keeps
 * its apps apart it gives this app only (`appOnly`). Org-wide in a legacy org.
 */
export function inviteToken(
  client: ClientRoutes<{ orgs: 'appTeamList' | 'inviteCreate' }>,
  org: string,
  passkey: PasskeyProvider,
  source: AppSource | null = null,
): Promise<AppInviteToken> {
  return appInvite(client, org, source, passkey);
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
 * that is inside the tracker, else the tracker's start.
 */
export function inviteRoute(invite: Pick<PendingInvite, 'route'> | null): string {
  const route = invite?.route ?? null;
  return route && (route === APP_ROUTE || route.startsWith(`${APP_ROUTE}/`)) ? route : APP_ROUTE;
}

