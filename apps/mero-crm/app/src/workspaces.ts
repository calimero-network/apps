import { ORG_CAPABILITIES, type AppInfo, type CalimeroClient, type PasskeyProvider } from '@calimero-network/mero-js';
import {
  appPeople,
  appTeamIdIn,
  appTarget,
  finishAppOrg,
  createInviteStore,
  inviteLinkBase as sharedInviteLinkBase,
  isAppOnly,
  leaveApp,
  leaveOrg,
  listAppInfos,
  orgInstanceOptions,
  orgsWithApp,
  removeFromApp,
  removeFromAppTeam,
  sourcePackage,
  type AppOrgView,
  type AppSource,
  type ClientRoutes,
  type ConsentClient,
  type InviteStore,
  type KeyValueStorage,
  type LeftApp,
  type PendingInvite,
} from '@calimero-apps/connect';
import { nodeBasename } from '@calimero-apps/node-served';

import { APP_NAME, APP_ROUTE, PRODUCT_NAME } from './config';
import { MeroCrmClient } from './generated/client';
import { consentOptions } from './orgConsent';

/**
 * v1 → Calimero 1.0, for this app:
 *
 * | v1 | here |
 * |---|---|
 * | a workspace: a namespace of the app | an **organization** (`createOrg`) |
 * | a pipeline: a context in the namespace (`serviceName: crm`) | an **app instance** in the org (`createApp(name, source, { org })`) |
 * | the pipeline name: the context's name | the instance's `name` |
 * | a namespace invitation (signed payload in a deflate+base58 link) | an **org invite** token in `?invite=` naming this app's team (the shared invite dialog; `redeemInvite` after sign-in) |
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

/** A pipeline: an app instance of this app in the workspace's org. */
export interface PipelineEntry {
  /** The app instance id. */
  contextId: string;
  name: string;
}

/**
 * The workspaces: the orgs this account is in that hold pipelines or were made
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
export async function listPipelines(
  client: ClientRoutes<{ apps: 'list' }>,
  source: AppSource,
  org: string,
): Promise<PipelineEntry[]> {
  const filter = typeof source === 'string' ? { bundle: source } : { package: source.package };
  const apps: AppInfo[] = await listAppInfos(client, filter);
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
 * What follows a workspace the node approved: its mark, this app's team, and
 * the member defaults (a passkey step-up, skipped on a session bound to the
 * app; declined, the org stays and the Members page offers them again).
 */
export async function finishWorkspace(
  client: ClientRoutes<{ orgs: 'capabilities' | 'get' | 'metadata' | 'appTeamsScope' }>,
  orgId: string,
  passkey: () => PasskeyProvider,
  source?: AppSource,
): Promise<CreatedWorkspace> {
  const made = await finishAppOrg(client, orgId, source, passkey, { capabilities: MEMBER_DEFAULTS });
  return {
    namespaceId: made.orgId,
    warning: made.capabilitiesError
      ? 'The workspace was created, but people you invite will not be able to add pipelines or invite others until an admin fixes the defaults on the Members page.'
      : null,
  };
}

/**
 * A new pipeline in `org`. It starts in USD; another currency is written into
 * its settings right after, best-effort, as v1 did: Settings can change it
 * later, and a currency is not worth failing an otherwise-created pipeline
 * over. Answers the instance id.
 */
export async function addPipeline(
  client: Pick<CalimeroClient, 'session' | 'events'> &
    ClientRoutes<{ apps: 'create' | 'call' | 'view'; orgs: 'get' | 'appTeamsScope' }>,
  source: AppSource,
  org: string,
  name: string,
  currency: string,
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
  const code = currency.trim().toUpperCase();
  if (code && code !== 'USD') {
    try {
      await new MeroCrmClient(client, appId, { after }).setCurrency({ currency: code });
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
  /**
   * Who has this app in the org, in org order: its app team's people; without
   * one, every member (no guest once the org has app teams). `roles` keeps
   * the whole org, which the role checks read.
   */
  people: string[];
  /** The org keeps its apps apart and this one has its team: invites and Remove are this app's only. */
  appOnly: boolean;
  /** This app's team in the org, which its invites name; `null` where there is none. */
  appTeam: string | null;
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
    appTeam: appTeamIdIn(view, pkg),
  };
}

/**
 * Takes `account` out of the workspace. Where the org has Mero CRM's own team
 * that is off the team, which a session bound to the app's frontend may do
 * itself; they stay in the organization. An org without one (a legacy org)
 * removes them from the organization: on a bound session, on the node's
 * consent page. Answers which it was.
 */
export async function removeFromWorkspace(
  client: Pick<CalimeroClient, 'session'> &
    ClientRoutes<{ orgs: 'get' | 'teamRemoveMember' | 'removeMember' }> &
    ConsentClient,
  org: string,
  source: AppSource | null,
  account: string,
  passkey: () => PasskeyProvider,
): Promise<'app' | 'org'> {
  const view = (await client.orgs.get({ org })) as AppOrgView;
  if (appTeamIdIn(view, sourcePackage(source))) {
    await removeFromAppTeam(client, org, source, account, passkey);
    return 'app';
  }
  return removeFromApp(client, org, source, account, passkey, {
    consent: consentOptions('Remove them from this workspace'),
  });
}

/**
 * The signed-in account leaves the workspace. In an org that keeps its apps
 * apart that is Mero CRM only, with `lastApp` set when it was their last app
 * there (offer {@link leaveWorkspaceOrg}); in an org with Mero CRM's team it
 * is off that team, staying in the organization. An org without one (a
 * legacy org) is left altogether: on a bound session, on the consent page.
 */
export async function leaveWorkspace(
  client: Pick<CalimeroClient, 'session'> &
    ClientRoutes<{ orgs: 'get' | 'appTeamList' | 'teamRemoveMember' | 'removeMember' }> &
    ConsentClient,
  org: string,
  source: AppSource | null,
  passkey: () => PasskeyProvider,
  self: string | undefined = client.session?.accountId,
): Promise<LeftApp> {
  if (!self) throw new Error('Sign in to leave.');
  const view = (await client.orgs.get({ org })) as AppOrgView;
  const pkg = sourcePackage(source);
  if (appTeamIdIn(view, pkg) && !isAppOnly(view, pkg)) {
    await removeFromAppTeam(client, org, source, self, passkey);
    return { left: 'app', lastApp: false };
  }
  return leaveApp(client, org, source, passkey, { self, consent: consentOptions('Leave this workspace') });
}

/** The signed-in account leaves the organization altogether, every app in it. On a bound session, on the consent page. */
export function leaveWorkspaceOrg(
  client: Pick<CalimeroClient, 'session'> & ClientRoutes<{ orgs: 'removeMember' }> & ConsentClient,
  org: string,
  passkey: () => PasskeyProvider,
  self?: string,
): Promise<void> {
  return leaveOrg(client, org, passkey, self, { consent: consentOptions('Leave this organization') });
}

// ── invitations ──────────────────────────────────────────────────────────────

/**
 * The page an invite link opens: this frontend's root, naming the page it was
 * made on (its route, relative to the router's basename) and `org`. The token
 * does not say which org it is for until it is redeemed, and redeeming spends
 * it, so the link carries the org for the app to tell an existing member "you
 * are already in" without spending a use. The invite dialog adds the token.
 *
 * The link stays under the served `/{version}/` root until every cluster's
 * served-host redirect keeps the query string (core's served-redirect fix).
 */
export function inviteLinkBase(org: string, location: Pick<Location, 'href'> = window.location): string {
  const url = new URL(location.href);
  const root = nodeBasename(url, '/');
  const route = url.pathname.startsWith(root) ? `/${url.pathname.slice(root.length)}` : url.pathname;
  return sharedInviteLinkBase({ org, route, root, origin: url.origin });
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

