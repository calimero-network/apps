// Teams and vaults on Calimero 1.0.
//
// | v1 | here |
// |---|---|
// | a team: a namespace of the app | an **organization** (`createOrg`) |
// | a personal vault: its own namespace, restricted subgroup | an org nobody else is invited to, marked `{ kind: 'personal' }` in its metadata |
// | a vault: a subgroup plus a context | an **app instance** in the org (`createApp(name, source, { org })`) |
// | an open vault (inherited by the team) | an instance with `org` access (the default) |
// | an invite-only vault (restricted subgroup) | an invite-only **team** of the org and an instance with `{ kind: 'team', team }` access |
// | the vault's name: `init` parameter + subgroup metadata | the instance's `name`, and the contract's `vaultName` (`renameVault` right after creating) |
// | a namespace invitation (signed payload, deflate + base58 link) | an **org invite** token (`invite`, a passkey step-up), `?invite=` in the link |
// | a vault invitation | an org invite naming the vault's team |
// | Admin / Member + capability bits on the namespace | org roles `owner`/`admin`/`member`/`guest` + org capability bits |
// | joining a context, waiting for sync | nothing: an instance is reachable as soon as the org lets you in |

import {
  ORG_CAPABILITIES,
  type AppInfo,
  type CalimeroClient,
  type PasskeyProvider,
} from '@calimero-network/mero-js';
import { markOrgFor, orgsWithApp, type AppSource } from '@calimero-apps/connect';
import {
  VaultSession,
  type DeviceKeyPair,
  type VaultApi,
} from '@calimero-network/mero-pass';

import { meroPass } from './meroPass';
import { vaultApiFor } from './vaultApi';
import { type TeamRole, normaliseRole } from './roles';

export type StatusFn = (message: string) => void;
const noop: StatusFn = () => {};

/** What every function here needs: the client, where vaults come from, a passkey for step-ups. */
export interface Conn {
  client: CalimeroClient;
  source: AppSource;
  passkey: () => PasskeyProvider;
  /** Keeps the stored session current; run after requests. */
  after?: () => void;
}

/** The vault at `appId`, as the session's `VaultApi`. */
export function vaultApi(
  conn: Pick<Conn, 'client' | 'after'>,
  appId: string,
): VaultApi {
  return vaultApiFor(meroPass(conn.client, appId, conn.after));
}

/** The first non-blank candidate, else `<prefix> <id…>`. */
export function displayName(
  candidates: readonly (string | null | undefined)[],
  id: string,
  fallbackPrefix: string,
): string {
  for (const candidate of candidates) {
    const trimmed = (candidate ?? '').trim();
    if (trimmed) return trimmed;
  }
  return `${fallbackPrefix} ${id.slice(0, 8)}…`;
}

// ── Organizations ────────────────────────────────────────────────────────────

/** The parts of `GET /orgs/{org}` read here. */
export interface OrgView {
  name: string;
  members: Record<string, string>;
  memberMetadata: Record<string, unknown>;
  metadata: unknown;
  defaultCapabilities: number;
  capabilities: Record<string, number>;
  teams: Record<
    string,
    {
      teamId: string;
      name: string;
      join: string;
      members: Record<string, boolean>;
    }
  >;
}

export async function readOrg(
  client: Pick<CalimeroClient, 'getOrg'>,
  org: string,
): Promise<OrgView> {
  const o = (await client.getOrg(org)) as Record<string, unknown>;
  return {
    name: typeof o.name === 'string' ? o.name : '',
    members: (o.members ?? {}) as Record<string, string>,
    memberMetadata: (o.memberMetadata ?? {}) as Record<string, unknown>,
    metadata: o.metadata ?? null,
    defaultCapabilities:
      typeof o.defaultCapabilities === 'number' ? o.defaultCapabilities : 0,
    capabilities: (o.capabilities ?? {}) as Record<string, number>,
    teams: (o.teams ?? {}) as OrgView['teams'],
  };
}

/** The marker in an org's metadata that makes it one person's private vault. */
export const PERSONAL = { kind: 'personal' } as const;

export function isPersonal(metadata: unknown): boolean {
  return (
    !!metadata &&
    typeof metadata === 'object' &&
    (metadata as { kind?: unknown }).kind === PERSONAL.kind
  );
}

export interface TeamRow {
  /** The org id; named for what the screens called a team. */
  namespaceId: string;
  name: string;
  memberCount: number;
  vaultCount: number;
  personal: boolean;
  /** This account's org role. */
  role: string;
}

/** The instances of this app (the dev bundle, or the package) this account reaches. */
export async function listInstances(
  conn: Pick<Conn, 'client' | 'source'>,
): Promise<AppInfo[]> {
  const filter =
    typeof conn.source === 'string'
      ? { bundle: conn.source }
      : { package: conn.source.package };
  return conn.client.listApps(filter);
}

/**
 * The teams: the orgs this account is in that hold a vault or were made for
 * Mero Pass, with their vault and member counts. An org made for another app
 * is offered under "Connect to an existing organization" instead.
 */
export async function listTeams(
  conn: Pick<Conn, 'client' | 'source'>,
): Promise<TeamRow[]> {
  const orgs = await orgsWithApp(conn.client, conn.source, { marked: true });
  const apps = await listInstances(conn);
  const rows = await Promise.all(
    orgs.map(async (o) => {
      const view = await readOrg(conn.client, o.orgId).catch(() => null);
      return {
        namespaceId: o.orgId,
        name: o.name,
        role: o.role,
        memberCount: view ? Object.keys(view.members).length : 0,
        vaultCount: apps.filter((a) => a.org === o.orgId).length,
        personal: isPersonal(view?.metadata),
      } satisfies TeamRow;
    }),
  );
  return rows.sort(
    (a, b) =>
      a.name.localeCompare(b.name) ||
      a.namespaceId.localeCompare(b.namespaceId),
  );
}

/**
 * What a member may do unless an admin says otherwise, as v1 set it at
 * creation: add vaults and invite people (and join open teams, the node's
 * own default).
 */
export const MEMBER_DEFAULTS =
  ORG_CAPABILITIES.CREATE_APP |
  ORG_CAPABILITIES.INVITE_MEMBERS |
  ORG_CAPABILITIES.JOIN_OPEN_TEAMS;

/**
 * A new team: an org you own, whose members may add vaults and invite. Setting
 * that default is a passkey step-up; refused, the team stays, and `warning`
 * says what it means.
 */
export async function createTeam(
  conn: Conn,
  name: string,
  onStatus: StatusFn = noop,
): Promise<{ namespaceId: string; warning: string | null }> {
  onStatus('Creating the team…');
  const namespaceId = await conn.client.createOrg(name);
  // Listed as a team before it holds a vault.
  await markOrgFor(conn.client, namespaceId, conn.source);
  await publishOwnName(conn.client, namespaceId);
  try {
    onStatus('Letting members add vaults and invite people…');
    await conn.client.setCapabilities(
      namespaceId,
      MEMBER_DEFAULTS,
      conn.passkey(),
    );
    return { namespaceId, warning: null };
  } catch {
    return {
      namespaceId,
      warning:
        'people you invite will not be able to add vaults or invite others until an Admin confirms it with a passkey on the People tab',
    };
  } finally {
    conn.after?.();
  }
}

// ── Vaults ───────────────────────────────────────────────────────────────────

export interface VaultRow {
  /** The app instance id: v1's subgroup and context in one. */
  vaultId: string;
  name: string;
  /** The app instance id (always set: an instance is reachable at once). */
  contextId: string | null;
  memberCount: number;
  /** Always true: there is nothing to join. Kept for the screens. */
  joined: boolean;
  /** Invite-only: only the vault's team reaches it. */
  restricted: boolean;
  /** The invite-only vault's team. */
  team: string | null;
}

/** The access an instance was created with (`GET /apps/{app}`). */
async function teamOf(
  client: CalimeroClient,
  appId: string,
): Promise<string | null> {
  try {
    const app = (await client.getApp(appId)) as {
      access?: { kind?: string; team?: string };
    };
    return app.access?.kind === 'team' && app.access.team
      ? app.access.team
      : null;
  } catch {
    return null;
  }
}

/** The vaults in `org` this account reaches, by name. */
export async function listVaults(
  conn: Pick<Conn, 'client' | 'source'>,
  org: string,
): Promise<VaultRow[]> {
  const [apps, view] = await Promise.all([
    listInstances(conn),
    readOrg(conn.client, org).catch(() => null),
  ]);
  const everyone = view ? Object.keys(view.members).length : 0;
  const rows = await Promise.all(
    apps
      .filter((a) => a.org === org)
      .map(async (a) => {
        const team = await teamOf(conn.client, a.appId);
        const teamMembers = team
          ? Object.keys(view?.teams[team]?.members ?? {})
          : [];
        return {
          vaultId: a.appId,
          name: a.name,
          contextId: a.appId,
          memberCount: team
            ? new Set([...teamMembers, a.owner]).size
            : everyone,
          joined: true,
          restricted: !!team,
          team,
        } satisfies VaultRow;
      }),
  );
  return rows.sort(
    (a, b) =>
      a.name.localeCompare(b.name) || a.vaultId.localeCompare(b.vaultId),
  );
}

/**
 * A new vault in `org`: an instance named `name`, its contract named the same
 * (`renameVault`). Invite-only makes an invite-only team for it first and gives
 * the instance that team's access.
 */
export async function createVault(
  conn: Conn,
  opts: { namespaceId: string; name: string; restricted: boolean },
  onStatus: StatusFn = noop,
): Promise<{ contextId: string }> {
  try {
    let access: Record<string, unknown> | undefined;
    if (opts.restricted) {
      onStatus('Creating the vault’s invite-only team…');
      const team = await conn.client.createTeam(
        opts.namespaceId,
        opts.name,
        'invite',
      );
      access = { kind: 'team', team };
    }
    onStatus('Creating the vault…');
    const contextId = await conn.client.createApp(opts.name, conn.source, {
      org: opts.namespaceId,
      ...(access ? { access } : {}),
    });
    onStatus('Naming it…');
    await meroPass(conn.client, contextId, conn.after).renameVault(opts.name);
    return { contextId };
  } finally {
    conn.after?.();
  }
}

/** The vault created in an org the account connects to Mero Pass ("Connect to an existing organization"). */
export const CONNECTED_VAULT_NAME = 'Shared';

/** Your private vault: an org only you are in, marked personal, with one vault. */
export async function createPersonalVault(
  conn: Conn,
  onStatus: StatusFn = noop,
): Promise<{ contextId: string; namespaceId: string }> {
  onStatus('Creating your private vault…');
  const namespaceId = await conn.client.createOrg('Private');
  await conn.client.setOrgMetadata(namespaceId, PERSONAL);
  const { contextId } = await createVault(
    conn,
    { namespaceId, name: 'Private', restricted: false },
    onStatus,
  );
  return { contextId, namespaceId };
}

/** The vault at `appId`: its org, name and team, or null when this account does not reach it. */
export async function findVaultByContext(
  conn: Pick<Conn, 'client' | 'source'>,
  appId: string,
): Promise<{
  namespaceId: string;
  vaultId: string;
  name: string;
  restricted: boolean;
  team: string | null;
  personal: boolean;
} | null> {
  const apps = await listInstances(conn);
  const app = apps.find((a) => a.appId === appId);
  if (!app || !app.org) return null;
  const [team, view] = await Promise.all([
    teamOf(conn.client, appId),
    readOrg(conn.client, app.org).catch(() => null),
  ]);
  return {
    namespaceId: app.org,
    vaultId: appId,
    name: app.name,
    restricted: !!team,
    team,
    personal: isPersonal(view?.metadata),
  };
}

/**
 * The accounts entitled to a vault's key right now: its team's members (and
 * its creator) when it is invite-only, otherwise everyone in the org. Null when
 * the node cannot answer: the caller then declines to hand out keys rather than
 * guessing.
 */
export async function vaultAudience(
  conn: Pick<Conn, 'client' | 'source'>,
  opts: { namespaceId: string; vaultId: string },
): Promise<Set<string> | null> {
  try {
    const view = await readOrg(conn.client, opts.namespaceId);
    const team = await teamOf(conn.client, opts.vaultId);
    if (!team) return new Set(Object.keys(view.members));
    const app = (await listInstances(conn)).find(
      (a) => a.appId === opts.vaultId,
    );
    return new Set([
      ...Object.keys(view.teams[team]?.members ?? {}),
      ...(app ? [app.owner] : []),
    ]);
  } catch {
    return null;
  }
}

// ── Invitations ──────────────────────────────────────────────────────────────

export const INVITE_VALIDITY = [
  { secs: 60 * 60, label: '1 hour' },
  { secs: 24 * 60 * 60, label: '24 hours' },
  { secs: 7 * 24 * 60 * 60, label: '7 days' },
] as const;
export const DEFAULT_INVITE_SECS = 24 * 60 * 60;

/** An invite into the team as a member (a passkey step-up); answers the token. */
export async function mintTeamInvite(
  conn: Conn,
  opts: { namespaceId: string; validForSecs?: number },
  onStatus: StatusFn = noop,
): Promise<string> {
  onStatus('Confirm with your passkey to create the invitation…');
  try {
    return await conn.client.invite(
      opts.namespaceId,
      'member',
      conn.passkey(),
      undefined,
      {
        ttlSecs: opts.validForSecs ?? DEFAULT_INVITE_SECS,
      },
    );
  } finally {
    conn.after?.();
  }
}

/**
 * An invite to one vault: for an invite-only vault, into the team as a member
 * and into the vault's own team; for an open vault, the team invite (an open
 * vault is reached by everyone in the team).
 */
export async function mintVaultInvite(
  conn: Conn,
  opts: { namespaceId: string; team: string | null; validForSecs?: number },
  onStatus: StatusFn = noop,
): Promise<string> {
  onStatus('Confirm with your passkey to create the invitation…');
  try {
    return await conn.client.invite(
      opts.namespaceId,
      'member',
      conn.passkey(),
      opts.team ? [opts.team] : undefined,
      { ttlSecs: opts.validForSecs ?? DEFAULT_INVITE_SECS },
    );
  } finally {
    conn.after?.();
  }
}

/** Where a redeemed invitation lands. */
export type Redeemed =
  { kind: 'team'; namespaceId: string } | { kind: 'joined' };

/** The org an invitation redeemed into, from whichever field the node named it. */
export function joinedOrg(redeemed: Record<string, unknown>): string | null {
  for (const key of ['org', 'orgId']) {
    const v = redeemed[key];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/** Redeem an invite token; answers where to land. */
export async function redeemInvite(
  conn: Pick<Conn, 'client' | 'after'>,
  token: string,
): Promise<Redeemed> {
  try {
    const org = joinedOrg(await conn.client.redeemInvite(token.trim()));
    if (org) await publishOwnName(conn.client, org);
    return org ? { kind: 'team', namespaceId: org } : { kind: 'joined' };
  } finally {
    conn.after?.();
  }
}

// ── Members ──────────────────────────────────────────────────────────────────

/** One person in a team. */
export interface TeamMember {
  accountId: string;
  name: string;
  role: TeamRole;
  /** The org role as the node spells it (`owner`, `admin`, `member`, `guest`). */
  rawRole: string;
  /** The capability mask that applies to them. */
  capabilities: number | null;
  isSelf: boolean;
}

/** A display name from org member metadata `{ name }`, or ''. */
export function memberName(view: OrgView, account: string): string {
  const name = (view.memberMetadata[account] as { name?: unknown } | null)
    ?.name;
  return typeof name === 'string' ? name.trim() : '';
}

export async function listTeamMembers(
  conn: Pick<Conn, 'client'>,
  namespaceId: string,
  selfAccountId: string | null,
): Promise<TeamMember[]> {
  const view = await readOrg(conn.client, namespaceId);
  return Object.entries(view.members)
    .map(([accountId, rawRole]) => ({
      accountId,
      name: memberName(view, accountId),
      role: normaliseRole(rawRole),
      rawRole,
      capabilities: capabilitiesOf(view, accountId),
      isSelf: accountId === selfAccountId,
    }))
    .sort((a, b) =>
      (a.name || a.accountId).localeCompare(b.name || b.accountId),
    );
}

/** The mask that applies to `account` in the org: all bits for an owner or admin. */
export function capabilitiesOf(view: OrgView, account: string): number | null {
  const role = view.members[account];
  if (!role) return null;
  if (role === 'owner' || role === 'admin') return ALL_CAPABILITIES;
  return view.capabilities[account] ?? view.defaultCapabilities;
}

export const ALL_CAPABILITIES = Object.values(ORG_CAPABILITIES).reduce(
  (all, bit) => all | bit,
  0,
);

/** This account's mask in `org`. */
export async function myCapabilities(
  conn: Pick<Conn, 'client'>,
  namespaceId: string,
  accountId: string,
): Promise<number | null> {
  return capabilitiesOf(await readOrg(conn.client, namespaceId), accountId);
}

/** Make `account` an org admin or member (a passkey step-up). */
export async function setMemberRole(
  conn: Conn,
  opts: { namespaceId: string; accountId: string; role: TeamRole },
): Promise<void> {
  try {
    await conn.client.setMember(
      opts.namespaceId,
      opts.accountId,
      opts.role,
      conn.passkey(),
    );
  } finally {
    conn.after?.();
  }
}

/** Remove `account` from the org (a passkey step-up). */
export async function removeTeamMember(
  conn: Conn,
  opts: { namespaceId: string; accountId: string },
): Promise<void> {
  try {
    await conn.client.removeMember(
      opts.namespaceId,
      opts.accountId,
      conn.passkey(),
    );
  } finally {
    conn.after?.();
  }
}

/** Your display name in every org you are in, where none is set yet. */
export async function publishMyName(
  conn: Pick<Conn, 'client'>,
  namespaceId: string,
  accountId: string,
  name: string,
): Promise<void> {
  if (!name.trim()) return;
  const view = await readOrg(conn.client, namespaceId);
  if (memberName(view, accountId)) return;
  await conn.client.setMemberMetadata(namespaceId, accountId, {
    name: name.trim(),
  });
}

/**
 * The account's sign-up name as its name in `org`, where it has none yet, so
 * teammates see a name rather than an id. Best effort: a failure leaves the id.
 */
async function publishOwnName(
  client: Pick<CalimeroClient, 'me' | 'getOrg' | 'setMemberMetadata'>,
  org: string,
): Promise<void> {
  try {
    const me = (await client.me()) as { accountId?: string; name?: string };
    if (me.accountId && me.name)
      await publishMyName(
        { client: client as CalimeroClient },
        org,
        me.accountId,
        me.name,
      );
  } catch {
    /* the id is shown instead */
  }
}

// ── Every vault this browser can open ────────────────────────────────────────

/** Run `fn` on the contract of every vault this account reaches; answers the sum. */
export async function forEachJoinedVault(
  conn: Pick<Conn, 'client' | 'source' | 'after'>,
  fn: (
    api: VaultApi,
    vault: { contextId: string; name: string },
  ) => Promise<number>,
  onStatus: StatusFn = noop,
): Promise<number> {
  let total = 0;
  for (const app of await listInstances(conn)) {
    onStatus(`${app.name}…`);
    total += await fn(vaultApi(conn, app.appId), {
      contextId: app.appId,
      name: app.name,
    });
  }
  return total;
}

/**
 * Open a session on every vault as `as`, registering it, and run `fn` on each
 * one that opens `ready`. A vault this key cannot open yet is skipped.
 */
export async function forEachOpenVault(
  conn: Pick<Conn, 'client' | 'source' | 'after'>,
  as: { device: DeviceKeyPair; fingerprint: string },
  label: string,
  fn: (
    session: VaultSession,
    vault: { contextId: string; name: string },
  ) => Promise<number>,
  onStatus: StatusFn = noop,
): Promise<number> {
  return forEachJoinedVault(
    conn,
    async (api, v) => {
      const session = new VaultSession(api, as.device, as.fingerprint, label);
      return (await session.open()) === 'ready' ? fn(session, v) : 0;
    },
    onStatus,
  );
}

/**
 * Hand every vault key `old` can open over to `next`, across every vault, and
 * retire `old` in each. Used when this browser's key is re-sealed, BEFORE the
 * old key is discarded.
 */
export async function migrateDevice(
  conn: Pick<Conn, 'client' | 'source' | 'after'>,
  old: { device: DeviceKeyPair; fingerprint: string },
  next: { device: DeviceKeyPair; fingerprint: string },
  label: string,
  onStatus: StatusFn = noop,
): Promise<number> {
  return forEachOpenVault(
    conn,
    old,
    label,
    async (session) => {
      const moved = await session.handOver(
        next.device,
        next.fingerprint,
        label,
      );
      await session.retire();
      return moved;
    },
    (name) => onStatus(`Moving the key for ${name}`),
  );
}
