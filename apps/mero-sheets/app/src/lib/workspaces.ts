/**
 * The workspace and its spreadsheets on Calimero 1.0.
 *
 * | v1 | here |
 * |---|---|
 * | the workspace: a namespace of the app on your node | an **organization** (`createOrg`) |
 * | a spreadsheet: a context in the namespace | an **app instance** in the org (`createApp(name, source, { org })`) |
 * | the spreadsheet's name: context metadata | the instance's `name` |
 * | a namespace invitation: a signed payload in a deflate+base58 link | an **org invite** token in `?invite=` (`invite` is a passkey step-up; `redeemInvite` after sign-in); a link that opens a spreadsheet also carries `&sheet=<app id>` |
 * | joining a context, waiting for it to reach your node | nothing: every member of the org reaches its instances, and nothing has to replicate first |
 * | the name a person set for the whole workspace: namespace member metadata | org **member metadata** `{ name }` |
 */
import { ORG_CAPABILITIES, type AppInfo, type CalimeroClient, type PasskeyProvider } from '@calimero-network/mero-js';
import {
  appInvite,
  appPeople,
  appTarget,
  createAppOrg,
  createInviteStore,
  inviteLink as sharedInviteLink,
  isAppOnly,
  isSpentInvite,
  leaveApp,
  leaveOrg,
  listAppInfos,
  orgInstanceOptions,
  removeFromApp,
  sourcePackage,
  SPENT_INVITE_COPY,
  type AppOrgView,
  type AppSource,
  type ClientRoutes,
  type InviteStore,
  type KeyValueStorage,
  type LeftApp,
  type PendingInvite as SharedPendingInvite,
} from '@calimero-apps/connect';
import { setOrgName } from '@calimero-apps/names';
import { nodeBasename } from '@calimero-apps/node-served';

import { APP_DISPLAY_NAME, APP_NAME } from '../config';

export type StatusFn = (message: string) => void;
const noop: StatusFn = () => {};

/** A workspace (org) this account is in. */
export interface WorkspaceOrg {
  orgId: string;
  name: string;
  /** `owner` | `admin` | `member` | `guest`. */
  role: string;
}

/** What `/me` answers about orgs. */
interface MeOrgs {
  orgs?: Array<{ orgId: string; name: string; role: string }>;
}

/** Every org this account is in. */
export async function listOrgs(client: ClientRoutes<{ auth: 'me' }>): Promise<WorkspaceOrg[]> {
  const me = (await client.auth.me()) as MeOrgs;
  return (me.orgs ?? []).map((o) => ({ orgId: o.orgId, name: o.name, role: o.role }));
}

/** The instances of this app (the dev bundle, or the package) the account reaches. */
export async function listInstances(client: ClientRoutes<{ apps: 'list' }>, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === 'string' ? { bundle: source } : { package: source.package };
  return listAppInfos(client, filter);
}

/**
 * The human name for a workspace. Never a bare id: an org created without a
 * name reads as the app's name and the start of its id.
 */
export function namespaceLabel(ns: { namespaceId: string; name?: string }, appName: string): string {
  return (ns.name ?? '').trim() || `${appName} · ${ns.namespaceId.slice(0, 6)}`;
}

/** What to call a spreadsheet whose instance has no name. */
export function spreadsheetFallbackLabel(contextId: string): string {
  return `Untitled · ${contextId.slice(0, 6)}`;
}

/** A spreadsheet in the workspace: one app instance. */
export interface SpreadsheetRow {
  /** The app instance id (v1's context id). */
  contextId: string;
  name: string;
  /** True when `name` is a placeholder rather than something someone typed. */
  unnamed: boolean;
}

/** The spreadsheets in `org`, by name. */
export function spreadsheetsIn(instances: readonly AppInfo[], org: string): SpreadsheetRow[] {
  return instances
    .filter((a) => a.org === org)
    .map((a) => {
      const name = (a.name ?? '').trim();
      return name
        ? { contextId: a.appId, name, unnamed: false }
        : { contextId: a.appId, name: spreadsheetFallbackLabel(a.appId), unnamed: true };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.contextId.localeCompare(b.contextId));
}

/**
 * What a member may do unless an admin sets otherwise, as v1 set it on a new
 * namespace: create spreadsheets and invite people (and join open teams, the
 * node's own default).
 */
export const MEMBER_DEFAULTS =
  ORG_CAPABILITIES.CREATE_APP | ORG_CAPABILITIES.INVITE_MEMBERS | ORG_CAPABILITIES.JOIN_OPEN_TEAMS;

/**
 * The workspace to create a spreadsheet in: `existing`, or a new org whose
 * members may create spreadsheets and invite. Setting those defaults is a
 * passkey step-up; refused, the org stays (only its owner and admins can then
 * create and invite) and `warning` says so.
 */
export async function ensureWorkspace(
  client: ClientRoutes<{ orgs: 'create' | 'capabilities' | 'get' | 'metadata' | 'appTeamsScope' }>,
  opts: { existing: string | null; name: string; passkey: () => PasskeyProvider; source?: AppSource | null },
  onStatus: StatusFn = noop,
): Promise<{ orgId: string; warning: string | null }> {
  if (opts.existing) return { orgId: opts.existing, warning: null };
  onStatus('Creating your workspace…');
  // The org, its member defaults, and Mero Sheets' own team, open (declined,
  // or an older node: a legacy org).
  const made = await createAppOrg(client, opts.name, opts.source, opts.passkey, {
    capabilities: MEMBER_DEFAULTS,
    mark: false,
  });
  return {
    orgId: made.orgId,
    warning: made.capabilitiesError
      ? 'The workspace was created, but people you invite will not be able to create spreadsheets or invite others.'
      : null,
  };
}

/**
 * A new spreadsheet in `org`: an app instance, named, on Mero Sheets' team
 * (`orgInstanceOptions`: made first, by an owner or admin, in an org whose
 * other apps have teams; organization access in a legacy org). Answers its id.
 */
export async function createSpreadsheet(
  client: Pick<CalimeroClient, 'session'> & ClientRoutes<{ apps: 'create'; orgs: 'get' | 'appTeamsScope' }>,
  source: AppSource,
  org: string,
  name: string,
  passkey: () => PasskeyProvider,
  onStatus: StatusFn = noop,
): Promise<string> {
  onStatus('Creating the spreadsheet…');
  return client.apps
    .create({
      name,
      ...appTarget(source),
      ...(await orgInstanceOptions(client, org, source, passkey, APP_DISPLAY_NAME)),
    })
    .then((r) => r.appId);
}

/**
 * Takes `account` out of the workspace (`removeFromApp`, a passkey step-up):
 * in an org that keeps its apps apart, out of Mero Sheets only, never out of
 * the org; elsewhere out of the org, as before.
 */
export function removeFromWorkspace(
  client: ClientRoutes<{ orgs: 'get' | 'teamRemoveMember' | 'removeMember' }>,
  org: string,
  source: AppSource | null,
  account: string,
  passkey: () => PasskeyProvider,
): Promise<'app' | 'org'> {
  return removeFromApp(client, org, source, account, passkey);
}

/**
 * The signed-in account leaves the workspace (`leaveApp`, a passkey step-up):
 * in an org that keeps its apps apart, Mero Sheets only, with `lastApp` set
 * when it was their last app there (offer {@link leaveWorkspaceOrg});
 * elsewhere the organization, as before.
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

// ── members ──────────────────────────────────────────────────────────────────

/** The parts of `GET /orgs/{org}` the screens read. */
export interface OrgMembers {
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> the name they set for the workspace, where one is set. */
  names: Map<string, string>;
  /** Who has Mero Sheets in the workspace, in org order: its app team, else the org (no guest once it has app teams). */
  people: string[];
  /** The org keeps its apps apart and Mero Sheets has its team: invites and Remove are its only. */
  appOnly: boolean;
}

export async function readMembers(
  client: ClientRoutes<{ orgs: 'get' }>,
  org: string,
  source: AppSource | null = null,
): Promise<OrgMembers> {
  const o = (await client.orgs.get({ org })) as Record<string, unknown>;
  const pkg = sourcePackage(source);
  const members = (o.members ?? {}) as Record<string, string>;
  const meta = (o.memberMetadata ?? {}) as Record<string, unknown>;
  const names = new Map<string, string>();
  for (const [account, value] of Object.entries(meta)) {
    const name = (value as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && name.trim()) names.set(account, name.trim());
  }
  return {
    roles: new Map(Object.entries(members)),
    names,
    people: appPeople(o as AppOrgView, pkg),
    appOnly: isAppOnly(o as AppOrgView, pkg),
  };
}

/**
 * Publishes the name `account` goes by across the workspace (org member
 * metadata, merged into what the member record holds): the one record every
 * spreadsheet in it reads.
 */
export async function publishWorkspaceName(
  client: ClientRoutes<{ orgs: 'memberMetadata' | 'get' }>,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  await setOrgName(client, org, account, name);
}

// ── invitations ──────────────────────────────────────────────────────────────

/**
 * The link that opens this frontend with `token` to redeem; with `sheet`, the
 * joiner lands in that spreadsheet instead of on the workspace's list. `org`
 * names the workspace the token admits to, so someone already in it (the
 * inviter opening their own link, say) is told so instead of spending the
 * token's single use.
 *
 * The link stays under the served `/{version}/` root until every cluster's
 * served-host redirect keeps the query string (core's served-redirect fix).
 */
export function inviteLink(
  token: string,
  sheet?: string | null,
  location: Pick<Location, 'href'> = window.location,
  org?: string | null,
): string {
  const url = new URL(location.href);
  return sharedInviteLink(token, { org, extra: { sheet }, root: nodeBasename(url, '/'), origin: url.origin });
}

/**
 * A workspace invitation as a link: an org invite naming Mero Sheets' team
 * (`appInvite`), approved with the inviter's passkey (412 step-up). `appOnly`
 * when it gives Mero Sheets only (an org that keeps its apps apart).
 */
export async function mintInvite(
  client: ClientRoutes<{ orgs: 'appTeamList' | 'inviteCreate' }>,
  opts: { org: string; sheet: string | null; passkey: () => PasskeyProvider; source?: AppSource | null },
  onStatus: StatusFn = noop,
): Promise<{ link: string; appOnly: boolean }> {
  onStatus('Approve the invitation with your passkey…');
  const { token, appOnly } = await appInvite(client, opts.org, opts.source, opts.passkey);
  return { link: inviteLink(token, opts.sheet, window.location, opts.org), appOnly };
}

export interface PendingInvite {
  token: string;
  /** The spreadsheet the link lands in, when it names one. */
  sheet: string | null;
  /** The workspace (org) the token admits to, when the link names it. */
  org: string | null;
}

/** This app's pending invite (`@calimero-apps/connect`), with the spreadsheet its link lands in. */
export const invites = createInviteStore(APP_NAME, { keep: ['sheet'] });

const LEGACY_PENDING = `${APP_NAME}:pending-invite`;

/**
 * Takes `?invite=` (and `&sheet=`, `&org=`) off the address bar into the
 * store, before anything renders: a person opening a link is usually not
 * signed in yet, and the token must survive the sign-up. Redeemed (and
 * dropped) once a session exists and the person says yes. An invite an
 * earlier build stored under its own key moves over first.
 */
export function captureInvite(loc: Pick<Location, 'href'> = window.location): void {
  migrateLegacyInvite();
  invites.capture(loc, { basename: nodeBasename(new URL(loc.href), '/') });
}

/** Moves an invite an earlier build stored under its own key into the shared store. */
export function migrateLegacyInvite(storage: KeyValueStorage = localStorage, into: InviteStore = invites): void {
  try {
    const raw = storage.getItem(LEGACY_PENDING);
    if (!raw) return;
    storage.removeItem(LEGACY_PENDING);
    const old = JSON.parse(raw) as Partial<PendingInvite>;
    if (typeof old.token !== 'string' || !old.token) return;
    into.put({
      token: old.token,
      org: typeof old.org === 'string' && old.org ? old.org : null,
      team: null,
      doc: null,
      route: null,
      extra: typeof old.sheet === 'string' && old.sheet ? { sheet: old.sheet } : {},
    });
  } catch {
    /* unreadable: nothing to move */
  }
}

/** The app's view of a pending invite. */
export function sheetsInvite(pending: SharedPendingInvite | null): PendingInvite | null {
  return pending ? { token: pending.token, sheet: pending.extra.sheet ?? null, org: pending.org } : null;
}

export function pendingInvite(): PendingInvite | null {
  return sheetsInvite(invites.pending());
}

export function dropInvite(): void {
  invites.drop();
}

/** The org an invitation redeemed into, from whichever field the node named it. */
export function joinedOrg(redeemed: Record<string, unknown>): string | null {
  for (const key of ['org', 'orgId']) {
    const v = redeemed[key];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/** What a join landed in, for the app page to open. */
export interface AcceptedInvite {
  namespaceId: string | null;
  contextId: string | null;
}

/** What to say when the node refused an invitation: it is unknown, already used, expired or revoked. */
export const INVITE_REFUSED = SPENT_INVITE_COPY;

/**
 * True when `e` is the node refusing the invitation itself (see
 * `INVITE_REFUSED`): the caller drops the token. A lapsed session, a rate
 * limit or the cluster unreachable keeps it.
 */
export function inviteRefused(e: unknown): boolean {
  return isSpentInvite(e);
}

/**
 * Whether this account is already in the workspace an invitation admits to:
 * `true` or `false` when the link names its org, `null` when it cannot be
 * told (an older link). Redeeming as an existing member spends the token's
 * single use, which then leaves the person it was meant for unable to join.
 */
export async function alreadyMember(client: ClientRoutes<{ auth: 'me' }>, invite: PendingInvite): Promise<boolean | null> {
  if (!invite.org) return null;
  try {
    return (await listOrgs(client)).some((o) => o.orgId === invite.org);
  } catch {
    return null;
  }
}
