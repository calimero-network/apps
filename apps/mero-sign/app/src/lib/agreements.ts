// ── Workspaces, agreements and the personal library on Calimero 1.0 ─────────
//
// | v1 (namespaces and contexts)          | here                                      |
// |---------------------------------------|-------------------------------------------|
// | a workspace: a namespace of the app   | an **organization** (`createOrg`)         |
// | an agreement: a subgroup + context    | an **app instance** in the org            |
// | `init(is_private, context_name)`      | `createApp`, then the contract's `setup`  |
// | entering by inheritance (`joinSubgroupInheritance`, polled) | `registerSelfAsParticipant` |
// | the private context (a hidden namespace) | an app instance with no org: only its owner reaches it |
// | namespace invitations (signed envelopes) | org invites (`client.invite`, a passkey step-up) |
//
// One log orders every write, so nothing here waits for replication: an app
// created or joined is there on the next request.

import type { AppInfo } from '@calimero-network/mero-js';
import { CalimeroError } from '@calimero-network/mero-js';

import { contractAt, type Conn } from './conn';

export type StatusFn = (message: string) => void;
const noop: StatusFn = () => {};

/** A readable label, or a short id — never an empty string. */
export function displayName(
  candidates: (string | null | undefined)[],
  id: string,
  fallbackPrefix: string,
): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? '').trim();
    if (trimmed) return trimmed;
  }
  return `${fallbackPrefix} ${id.slice(0, 8)}…`;
}

/** Calimero Cloud attests every node it runs; `merod local` uses mock quotes. */
export type TeeMode = 'relay' | 'replica';
export function clusterTeeMode(conn: Pick<Conn, 'target'>): TeeMode | null {
  return conn.target.kind === 'cloud' ? 'replica' : null;
}

/** The marker in an org's metadata that makes it a Mero Sign workspace. */
export const WORKSPACE_KIND = 'mero-sign:workspace';

/** The name of the personal library's app instance. */
export const LIBRARY_NAME = 'Mero Sign library';

/** The instances of this app (the dev bundle, or the package) this account reaches. */
export async function listInstances(conn: Pick<Conn, 'client' | 'source'>): Promise<AppInfo[]> {
  const filter =
    typeof conn.source === 'string' ? { bundle: conn.source } : { package: conn.source.package };
  return conn.client.listApps(filter);
}

export interface WorkspaceRow {
  /** The org id; named for what the screens called a workspace. */
  namespaceId: string;
  name: string;
  memberCount: number;
  agreementCount: number;
}

interface OrgView {
  name: string;
  members: Record<string, string>;
  memberMetadata: Record<string, unknown>;
  metadata: unknown;
}

export async function readOrg(conn: Pick<Conn, 'client'>, org: string): Promise<OrgView> {
  const o = (await conn.client.getOrg(org)) as Record<string, unknown>;
  return {
    name: typeof o.name === 'string' ? o.name : '',
    members: (o.members ?? {}) as Record<string, string>,
    memberMetadata: (o.memberMetadata ?? {}) as Record<string, unknown>,
    metadata: o.metadata ?? null,
  };
}

function isWorkspace(metadata: unknown): boolean {
  return (
    !!metadata &&
    typeof metadata === 'object' &&
    (metadata as { kind?: unknown }).kind === WORKSPACE_KIND
  );
}

/**
 * The workspaces this account is in: the orgs marked as Mero Sign workspaces,
 * and any other org holding one of this app's instances.
 */
export async function listWorkspaces(conn: Pick<Conn, 'client' | 'source'>): Promise<WorkspaceRow[]> {
  const me = (await conn.client.me()) as {
    orgs?: Array<{ orgId: string; name: string; role: string }>;
  };
  const apps = await listInstances(conn);
  const rows = await Promise.all(
    (me.orgs ?? []).map(async (o) => {
      const view = await readOrg(conn, o.orgId).catch(() => null);
      const agreementCount = apps.filter((a) => a.org === o.orgId).length;
      if (!isWorkspace(view?.metadata) && agreementCount === 0) return null;
      return {
        namespaceId: o.orgId,
        name: displayName([o.name, view?.name], o.orgId, 'Workspace'),
        memberCount: view ? Object.keys(view.members).length : 0,
        agreementCount,
      } satisfies WorkspaceRow;
    }),
  );
  return rows
    .filter((r): r is WorkspaceRow => r !== null)
    .sort((a, b) => a.name.localeCompare(b.name) || a.namespaceId.localeCompare(b.namespaceId));
}

/** A new workspace: an org this account owns, marked as one. */
export async function createWorkspace(
  conn: Pick<Conn, 'client'>,
  name: string,
  onStatus: StatusFn = noop,
): Promise<{ namespaceId: string }> {
  onStatus('Creating the workspace…');
  const namespaceId = await conn.client.createOrg(name);
  onStatus("Recording the workspace's name…");
  await conn.client.setOrgMetadata(namespaceId, { kind: WORKSPACE_KIND, name });
  return { namespaceId };
}

export interface AgreementRow {
  agreementId: string;
  name: string;
  /** The app id: what v1 called the context. */
  contextId: string | null;
  memberCount: number;
  teeMode: TeeMode | null;
  /** Whether this account is a participant. */
  joined: boolean;
  identity: string | null;
}

/** The agreements of a workspace, with their participant counts. */
export async function listAgreements(conn: Conn, namespaceId: string): Promise<AgreementRow[]> {
  const apps = (await listInstances(conn)).filter((a) => a.org === namespaceId);
  const rows = await Promise.all(
    apps.map(async (a) => {
      const details = await contractAt(conn, a.appId)
        .getContextDetails()
        .catch(() => null);
      const participants = details?.participants ?? [];
      return {
        agreementId: a.appId,
        name: displayName([details?.contextName, a.name], a.appId, 'Agreement'),
        contextId: a.appId,
        memberCount: participants.length,
        teeMode: clusterTeeMode(conn),
        joined: participants.some((p) => p.userId === conn.accountId),
        identity: conn.accountId,
      } satisfies AgreementRow;
    }),
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.agreementId.localeCompare(b.agreementId));
}

/** A new agreement in a workspace: the instance, then `setup` names it. Its creator is its first admin. */
export async function createAgreement(
  conn: Conn,
  opts: { namespaceId: string; name: string },
  onStatus: StatusFn = noop,
): Promise<{ agreementId: string; contextId: string }> {
  onStatus('Creating the agreement…');
  const appId = await conn.client.createApp(opts.name, conn.source, { org: opts.namespaceId });
  onStatus('Preparing its documents…');
  await contractAt(conn, appId).setup(false, opts.name);
  return { agreementId: appId, contextId: appId };
}

/**
 * Enter an agreement: register as a signer unless already a participant.
 * Refused (with the contract's message) for someone an admin removed.
 */
export async function enterAgreement(
  conn: Conn,
  opts: { contextId: string },
  onStatus: StatusFn = noop,
): Promise<string> {
  const c = contractAt(conn, opts.contextId);
  const level = await c.getUserPermission(conn.accountId).catch(() => null);
  if (!level) {
    onStatus('Joining the agreement…');
    await c.registerSelfAsParticipant();
  }
  return conn.accountId;
}

/** Which agreement an invitation should land in: the hinted one if it is there, or the only one. */
export function pickInvitedAgreement<T extends { contextId: string | null }>(
  agreements: T[],
  hintedContextId: string | undefined,
): T | null {
  const joinable = agreements.filter((a) => !!a.contextId);
  if (hintedContextId) {
    const hinted = joinable.find((a) => a.contextId === hintedContextId);
    if (hinted) return hinted;
  }
  return joinable.length === 1 ? joinable[0] : null;
}

// ── the personal library ─────────────────────────────────────────────────────

const pendingLibrary = new WeakMap<object, Promise<string>>();

/**
 * This account's personal library (saved signatures, bookmarked agreements):
 * an instance with no org, which only its owner reaches. Made on first use.
 * Idempotent and shared between concurrent callers.
 */
export function ensureLibrary(conn: Conn, onStatus: StatusFn = noop): Promise<string> {
  const key = conn.client as object;
  const running = pendingLibrary.get(key);
  if (running) return running;
  const p = (async () => {
    const mine = (await listInstances(conn)).filter(
      (a) => a.org === null && a.owner === conn.accountId,
    );
    for (const a of mine) {
      if (await contractAt(conn, a.appId).isDefaultPrivateContext().catch(() => false)) {
        return a.appId;
      }
    }
    onStatus('Setting up your signature library…');
    const appId = await conn.client.createApp(LIBRARY_NAME, conn.source, {});
    await contractAt(conn, appId).setup(true, 'default');
    return appId;
  })();
  pendingLibrary.set(key, p);
  p.catch(() => pendingLibrary.delete(key));
  return p;
}

// ── invitations ──────────────────────────────────────────────────────────────

/** How long an invitation link lasts: a day, as v1's did. */
export const INVITE_TTL_SECS = 86_400;

/** An invitation into a workspace as a member, approved with the inviter's passkey. */
export function mintWorkspaceInvite(conn: Conn, namespaceId: string): Promise<string> {
  return conn.client.invite(namespaceId, 'member', conn.passkey(), undefined, {
    ttlSecs: INVITE_TTL_SECS,
  });
}

/** The org an invitation redeemed into, from whichever field the node named it. */
export function joinedOrg(redeemed: Record<string, unknown>): string | null {
  for (const key of ['org', 'orgId']) {
    const v = redeemed[key];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/** Whether a failed redeem can never succeed (used, expired, revoked). */
export function isFinalRefusal(e: unknown): boolean {
  return e instanceof CalimeroError && e.status < 500;
}

// ── names ────────────────────────────────────────────────────────────────────

/** Display names from org member metadata (`{ name }`). */
export async function memberNames(conn: Conn, namespaceId: string): Promise<Record<string, string>> {
  const view = await readOrg(conn, namespaceId);
  const out: Record<string, string> = {};
  for (const [account, meta] of Object.entries(view.memberMetadata)) {
    const name = (meta as { name?: unknown } | null)?.name;
    if (typeof name === 'string' && name.trim()) out[account] = name.trim();
  }
  return out;
}

/** Publish the caller's display name in a workspace. */
export function publishMyName(conn: Conn, namespaceId: string, name: string): Promise<void> {
  return conn.client.setMemberMetadata(namespaceId, conn.accountId, { name });
}
