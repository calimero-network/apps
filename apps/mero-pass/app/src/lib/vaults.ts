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
//
// Hyperfeed Pass has its own **app team** in the org (core#4890), through
// `@calimero-apps/connect`'s org-app module: a new team (org) gets it, open
// (everyone in the org has Hyperfeed Pass); open vaults use team access on it, so
// "open" now means "everyone in Hyperfeed Pass here"; invites name it; the member
// list and an open vault's key audience are its people. Once an admin keeps
// the org's apps apart in Calimero Home (`shared`), an invite gives Hyperfeed Pass
// only and Remove takes someone out of Hyperfeed Pass (its team and the
// invite-only vault teams the remover may change), not out of the org. An
// invite-only vault keeps its own top-level team: core lets only an app team's
// leads create teams below it. An org without an app team (made before app
// teams, a node without them, a raw dev bundle) is legacy, as before.

import {
  passkeyConfirm,
  ORG_CAPABILITIES,
  type AppInfo,
  type CalimeroClient,
  type PasskeyProvider,
} from '@calimero-network/mero-js';
import {
  appPeople,
  appTarget,
  appTeamIdIn,
  finishAppOrg,
  isAppOnly,
  listAppInfos,
  appInviteTeams,
  orgInstanceOptions,
  orgsWithApp,
  removeFromApp,
  removeFromAppTeam,
  removeFromPrivateTeam,
  sourcePackage,
  type AppOrgView,
  type AppSource,
  type ClientRoutes,
} from '@calimero-apps/connect';
import {
  VaultSession,
  type DeviceKeyPair,
  type VaultApi,
} from '@calimero-network/mero-pass';

import { MeroPassClient } from '../generated/client';
import { vaultApiFor } from './vaultApi';
import { type TeamRole, normaliseRole } from './roles';
import { askRoleConsent, orgConsentOptions } from './orgConsent';

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
  return vaultApiFor(new MeroPassClient(conn.client, appId, { after: conn.after }));
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
  /** How the org holds its apps (core#4890); absent on a node that does not say. */
  mode?: unknown;
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
  client: ClientRoutes<{ orgs: 'get' }>,
  org: string,
): Promise<OrgView> {
  const o = (await client.orgs.get({ org })) as Record<string, unknown>;
  return {
    name: typeof o.name === 'string' ? o.name : '',
    members: (o.members ?? {}) as Record<string, string>,
    memberMetadata: (o.memberMetadata ?? {}) as Record<string, unknown>,
    metadata: o.metadata ?? null,
    defaultCapabilities:
      typeof o.defaultCapabilities === 'number' ? o.defaultCapabilities : 0,
    capabilities: (o.capabilities ?? {}) as Record<string, number>,
    teams: (o.teams ?? {}) as OrgView['teams'],
    mode: o.mode,
  };
}

/** The name Hyperfeed Pass is added to an organization under, in what an owner or admin is told. */
export const PRODUCT_NAME = 'Hyperfeed Pass';

/** Who has Hyperfeed Pass in `view`: its app team, else everyone in the org (no guest once it has app teams). */
export function passPeople(view: OrgView, source: AppSource | null): string[] {
  return appPeople(view as unknown as AppOrgView, sourcePackage(source));
}

/**
 * An instance's team as a vault's own: `null` for an open vault, which is on
 * Hyperfeed Pass's app team (or org access); the invite-only vault's team otherwise.
 */
function vaultTeam(view: OrgView | null, source: AppSource | null, team: string | null): string | null {
  if (!team || !view) return team;
  return appTeamIdIn(view as unknown as AppOrgView, sourcePackage(source)) === team ? null : team;
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
  return listAppInfos(conn.client, filter);
}

/**
 * The teams: the orgs this account is in that hold a vault or were made for
 * Hyperfeed Pass, with their vault and member counts. An org made for another app
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
        memberCount: view ? passPeople(view, conn.source).length : 0,
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
 * What follows a team the node approved: its mark, the member defaults (a
 * passkey step-up, skipped on a session bound to the app; refused, the team
 * stays and `warning` says what it means), Hyperfeed Pass's own team, open, and
 * your name in it.
 */
export async function finishTeam(
  conn: Conn,
  namespaceId: string,
  accountId: string,
  selfName: string,
  onStatus: StatusFn = noop,
): Promise<{ namespaceId: string; warning: string | null }> {
  onStatus('Setting up the team…');
  try {
    const made = await finishAppOrg(conn.client, namespaceId, conn.source, conn.passkey, {
      capabilities: MEMBER_DEFAULTS,
    });
    // Best effort: without it teammates see an id.
    await publishMyName(conn, namespaceId, accountId, selfName).catch(() => {});
    return {
      namespaceId: made.orgId,
      warning: made.capabilitiesError
        ? 'people you invite will not be able to add vaults or invite others until an Admin confirms it with a passkey on the People tab'
        : null,
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
    const app = (await client.apps.get({ app: appId })) as {
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
  const everyone = view ? passPeople(view, conn.source).length : 0;
  const rows = await Promise.all(
    apps
      .filter((a) => a.org === org)
      .map(async (a) => {
        const team = vaultTeam(view, conn.source, await teamOf(conn.client, a.appId));
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
    let access: { kind: 'team'; team: string } | undefined;
    if (opts.restricted) {
      onStatus('Creating the vault’s invite-only team…');
      const team = (await conn.client.orgs.teamCreate({ org: opts.namespaceId, name: opts.name, join: 'invite' }))
        .teamId;
      access = { kind: 'team', team };
    }
    onStatus('Creating the vault…');
    // An open vault is on Hyperfeed Pass's team (made first, by an owner or admin,
    // in an org whose other apps have teams), or org access in a legacy org.
    const contextId = (await conn.client.apps.create({ name: opts.name, ...appTarget(conn.source), ...(access
        ? { org: opts.namespaceId, access }
        : await orgInstanceOptions(conn.client, opts.namespaceId, conn.source, conn.passkey, PRODUCT_NAME)) })).appId;
    onStatus('Naming it…');
    await new MeroPassClient(conn.client, contextId, { after: conn.after }).renameVault({ name: opts.name });
    return { contextId };
  } finally {
    conn.after?.();
  }
}

/** The vault created in an org the account connects to Hyperfeed Pass ("Connect to an existing organization"). */
export const CONNECTED_VAULT_NAME = 'Shared';

/** Your private vault in an org the node approved: marked personal, with one vault named `name`. */
export async function finishPersonalVault(
  conn: Conn,
  namespaceId: string,
  name: string,
  onStatus: StatusFn = noop,
): Promise<{ contextId: string; namespaceId: string }> {
  onStatus('Creating your private vault…');
  await finishAppOrg(conn.client, namespaceId, conn.source, conn.passkey, { mark: false });
  await conn.client.orgs.metadata({ org: namespaceId, metadata: PERSONAL });
  const { contextId } = await createVault(conn, { namespaceId, name, restricted: false }, onStatus);
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
  const [instanceTeam, view] = await Promise.all([
    teamOf(conn.client, appId),
    readOrg(conn.client, app.org).catch(() => null),
  ]);
  const team = vaultTeam(view, conn.source, instanceTeam);
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
    const team = vaultTeam(view, conn.source, await teamOf(conn.client, opts.vaultId));
    // An open vault: everyone in Hyperfeed Pass here (its app team, else the org).
    if (!team) return new Set(passPeople(view, conn.source));
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

/**
 * The teams an invite names: Hyperfeed Pass's app team (`appInviteTeams`), and
 * `vaultTeam` for an invite-only vault.
 */
export async function inviteTeams(
  conn: Pick<Conn, 'client' | 'source'>,
  org: string,
  vaultTeam: string | null = null,
): Promise<{ teams: string[]; appOnly: boolean }> {
  const { teams, appOnly } = await appInviteTeams(conn.client, org, conn.source);
  return { teams: vaultTeam ? [...teams, vaultTeam] : teams, appOnly };
}

/** Where a redeemed invitation lands. */
export type Redeemed =
  { kind: 'team'; namespaceId: string } | { kind: 'joined' };

/** A team the account has just joined: publishes its name there, so teammates see it. */
export async function joinedTeam(
  conn: Pick<Conn, 'client' | 'after'>,
  org: string,
): Promise<void> {
  try {
    await publishOwnName(conn.client, org);
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

/**
 * The people of the team: who has Hyperfeed Pass in the org (its app team, else
 * every member, no guest once the org has app teams).
 */
export async function listTeamMembers(
  conn: Pick<Conn, 'client'> & { source?: AppSource },
  namespaceId: string,
  selfAccountId: string | null,
): Promise<TeamMember[]> {
  const view = await readOrg(conn.client, namespaceId);
  return passPeople(view, conn.source ?? null)
    .map((accountId) => [accountId, view.members[accountId] ?? 'member'] as const)
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

/**
 * Make `account` an org admin or member (a passkey step-up). On a session
 * bound to Hyperfeed Pass's frontend the node refuses an org role, so it is the
 * consent page's: answers `consent` once the page is opening.
 */
export async function setMemberRole(
  conn: Conn,
  opts: { namespaceId: string; accountId: string; role: TeamRole; name?: string },
): Promise<'done' | 'consent'> {
  try {
    const intent = {
      kind: 'setMemberRole' as const,
      org: opts.namespaceId,
      account: opts.accountId,
      role: opts.role,
      name: opts.name ?? '',
    };
    if (await askRoleConsent(conn.client, intent)) return 'consent';
    await conn.client.orgs.setMember(
      { org: opts.namespaceId, account: opts.accountId, role: opts.role },
      { confirm: passkeyConfirm(conn.passkey()) },
    );
    return 'done';
  } finally {
    conn.after?.();
  }
}

/**
 * Remove `account` from Hyperfeed Pass in the team (a passkey step-up), leaving
 * them in the organization wherever Hyperfeed Pass has its app team there: off
 * that team (every open vault) and off the invite-only vaults' teams the
 * remover may change, which a session bound to Hyperfeed Pass's frontend may do
 * itself. Only an org without the app team (legacy) takes them out of the
 * organization, on the consent page when the session is bound
 * (`removeFromApp`, which then never settles).
 */
export async function removeTeamMember(
  conn: Conn,
  opts: { namespaceId: string; accountId: string; name?: string },
): Promise<'app' | 'org'> {
  try {
    const pkg = sourcePackage(conn.source);
    const view = (await conn.client.orgs.get({ org: opts.namespaceId })) as AppOrgView;
    const appTeam = appTeamIdIn(view, pkg);
    const vaultTeams = new Set<string>();
    if (appTeam) {
      for (const app of (await listInstances(conn)).filter((a) => a.org === opts.namespaceId)) {
        const team = await teamOf(conn.client, app.appId);
        if (team && team !== appTeam) vaultTeams.add(team);
      }
    }
    if (appTeam && !isAppOnly(view, pkg)) {
      await removeFromAppTeam(conn.client, opts.namespaceId, conn.source, opts.accountId, conn.passkey);
      for (const team of vaultTeams) {
        if (!(opts.accountId in (view.teams?.[team]?.members ?? {}))) continue;
        await removeFromPrivateTeam(conn.client, opts.namespaceId, team, opts.accountId, conn.passkey).catch(
          (e: unknown) => console.warn(`removeTeamMember: ${team} still lists ${opts.accountId}`, e),
        );
      }
      return 'app';
    }
    return await removeFromApp(conn.client, opts.namespaceId, conn.source, opts.accountId, conn.passkey, {
      privateTeams: () => [...vaultTeams],
      consent: orgConsentOptions(opts.name ?? ''),
    });
  } finally {
    conn.after?.();
  }
}

/** Whether the org keeps its apps apart and Hyperfeed Pass has its team there (invites and Remove are Hyperfeed Pass's only). */
export async function passOnly(conn: Pick<Conn, 'client' | 'source'>, namespaceId: string): Promise<boolean> {
  return isAppOnly((await conn.client.orgs.get({ org: namespaceId })) as AppOrgView, sourcePackage(conn.source));
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
  await conn.client.orgs.memberMetadata({ org: namespaceId, account: accountId, metadata: {
    name: name.trim(),
  } });
}

/**
 * The account's sign-up name as its name in `org`, where it has none yet, so
 * teammates see a name rather than an id. Best effort: a failure leaves the id.
 */
async function publishOwnName(
  client: ClientRoutes<{ auth: 'me'; orgs: 'get' | 'memberMetadata' }>,
  org: string,
): Promise<void> {
  try {
    const me = (await client.auth.me()) as { accountId?: string; name?: string };
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
