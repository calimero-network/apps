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
import type { AppSource, KeyValueStorage } from '@calimero-apps/connect';

import { APP_NAME } from '../config';

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
export async function listOrgs(client: Pick<CalimeroClient, 'me'>): Promise<WorkspaceOrg[]> {
  const me = (await client.me()) as MeOrgs;
  return (me.orgs ?? []).map((o) => ({ orgId: o.orgId, name: o.name, role: o.role }));
}

/** The instances of this app (the dev bundle, or the package) the account reaches. */
export async function listInstances(client: Pick<CalimeroClient, 'listApps'>, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === 'string' ? { bundle: source } : { package: source.package };
  return client.listApps(filter);
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
  client: Pick<CalimeroClient, 'createOrg' | 'setCapabilities'>,
  opts: { existing: string | null; name: string; passkey: () => PasskeyProvider },
  onStatus: StatusFn = noop,
): Promise<{ orgId: string; warning: string | null }> {
  if (opts.existing) return { orgId: opts.existing, warning: null };
  onStatus('Creating your workspace…');
  const orgId = await client.createOrg(opts.name);
  onStatus('Letting members create spreadsheets and invite…');
  try {
    await client.setCapabilities(orgId, MEMBER_DEFAULTS, opts.passkey());
    return { orgId, warning: null };
  } catch {
    return {
      orgId,
      warning: 'The workspace was created, but people you invite will not be able to create spreadsheets or invite others.',
    };
  }
}

/** A new spreadsheet in `org`: an app instance, named. Answers its id. */
export async function createSpreadsheet(
  client: Pick<CalimeroClient, 'createApp'>,
  source: AppSource,
  org: string,
  name: string,
  onStatus: StatusFn = noop,
): Promise<string> {
  onStatus('Creating the spreadsheet…');
  return client.createApp(name, source, { org });
}

// ── members ──────────────────────────────────────────────────────────────────

/** The parts of `GET /orgs/{org}` the screens read. */
export interface OrgMembers {
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> the name they set for the workspace, where one is set. */
  names: Map<string, string>;
}

export async function readMembers(client: Pick<CalimeroClient, 'getOrg'>, org: string): Promise<OrgMembers> {
  const o = (await client.getOrg(org)) as Record<string, unknown>;
  const members = (o.members ?? {}) as Record<string, string>;
  const meta = (o.memberMetadata ?? {}) as Record<string, unknown>;
  const names = new Map<string, string>();
  for (const [account, value] of Object.entries(meta)) {
    const name = (value as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && name.trim()) names.set(account, name.trim());
  }
  return { roles: new Map(Object.entries(members)), names };
}

/** Publishes the name `account` goes by across the workspace (org member metadata). */
export async function publishWorkspaceName(
  client: Pick<CalimeroClient, 'setMemberMetadata'>,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  await client.setMemberMetadata(org, account, { name });
}

// ── invitations ──────────────────────────────────────────────────────────────

/**
 * The link that opens this frontend with `token` to redeem; with `sheet`, the
 * joiner lands in that spreadsheet instead of on the workspace's list.
 */
export function inviteLink(
  token: string,
  sheet?: string | null,
  location: Pick<Location, 'origin' | 'pathname'> = window.location,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('invite', token);
  if (sheet) url.searchParams.set('sheet', sheet);
  return url.toString();
}

/** A workspace invitation as a link: an org invite, approved with the inviter's passkey (412 step-up). */
export async function mintInvite(
  client: Pick<CalimeroClient, 'invite'>,
  opts: { org: string; sheet: string | null; passkey: () => PasskeyProvider },
  onStatus: StatusFn = noop,
): Promise<string> {
  onStatus('Approve the invitation with your passkey…');
  const token = await client.invite(opts.org, 'member', opts.passkey());
  return inviteLink(token, opts.sheet);
}

export interface PendingInvite {
  token: string;
  /** The spreadsheet the link lands in, when it names one. */
  sheet: string | null;
}

const PENDING = `${APP_NAME}:pending-invite`;

/**
 * Takes `?invite=` (and `&sheet=`) off the address bar into storage, before
 * anything renders: a person opening a link is usually not signed in yet, and
 * the token must survive the sign-up. Redeemed (and dropped) once a session
 * exists and the person says yes.
 */
export function captureInvite(storage: KeyValueStorage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get('invite');
  if (!token) return;
  const pending: PendingInvite = { token, sheet: url.searchParams.get('sheet') };
  try {
    storage.setItem(PENDING, JSON.stringify(pending));
  } catch {
    return;
  }
  url.searchParams.delete('invite');
  url.searchParams.delete('sheet');
  window.history.replaceState(null, '', url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): PendingInvite | null {
  try {
    const raw = storage.getItem(PENDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingInvite>;
    return typeof parsed.token === 'string' && parsed.token
      ? { token: parsed.token, sheet: typeof parsed.sheet === 'string' ? parsed.sheet : null }
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
