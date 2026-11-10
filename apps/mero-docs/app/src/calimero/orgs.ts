// Workspaces, folders and their members on Calimero 1.0's organizations.
//
// | v1 (namespaces, mero-js 26 `AdminApiClient`) | here (mero-js 28 `CalimeroClient`) |
// |---|---|
// | namespace (a workspace)                     | an **organization** (`createOrg`)                           |
// | the namespace's root group                  | the organization itself (group id = org id)                 |
// | folder subgroup, Open / Restricted          | a **team**, `join: everyone` / `join: invite`               |
// | subgroup metadata `{ name, data.color }`    | the team's `name` and `metadata.color`                      |
// | the folder's docs context                   | an app instance with `access: team`, id in `metadata.docsApp` |
// | the registry context                        | an org-access app instance, id in org `metadata.registryApp` |
// | group role Admin / Member / ReadOnly        | org: owner+admin / member / guest; team row: lead / member / readOnly |
// | capability bits (`MemberCapabilities`)      | the same bits (`ORG_CAPABILITIES`), org-wide or per team row |
// | member metadata `{ name }`                  | org member metadata `{ name }`                              |
// | namespace / group invitations               | org invites, naming the folder's team for a folder invite   |
//
// `OrgAdmin` answers with the method names and shapes v1's admin client had
// (`listGroupMembers`, `getGroupInfo`, `addGroupMembers`, …), so the screens
// and hooks that read them did not have to change. A "group id" is an org id
// (the workspace root) or a team id; every read comes from one `GET /orgs/{org}`
// snapshot, cached briefly and dropped after each write.
//
// Every membership change (a role, capabilities, adding or removing someone,
// an invite, deleting or leaving a workspace) is a passkey step-up on 1.0, so
// those calls prompt for the caller's passkey.
//
// Docs has its own **app team** in the org (core#4890), through
// `@calimero-apps/connect`'s org-app module: a new workspace's team is open,
// the registry instance uses team access on it, invites name it, and the
// workspace's member list is its people. Once an admin keeps the org's apps
// apart in Calimero Home (`shared`), an invite gives Docs only, and Remove and
// Leave take someone out of Docs, not out of the org. App teams (Docs' and
// other apps') are not folders. Folders stay teams of their own: core lets
// only an app team's leads create teams below it, so they are not moved under
// Docs' team. An org without one (made before app teams, a node without
// them, a raw dev bundle) is legacy, as before.

import {
  CalimeroError,
  NotFound,
  type AppInfo,
  type CalimeroClient,
  type PasskeyProvider,
} from '@calimero-network/mero-js';
import {
  appInvite,
  appPeople,
  createAppOrg,
  leaveApp,
  leaveOrg,
  orgModeOf,
  orgWideAccess,
  removeFromApp,
  removeFromPrivateTeam,
  sourcePackage,
  type AppOrgView,
  type AppSource,
  type LeftApp,
} from '@calimero-apps/connect';
import type { OrgMode } from '@calimero-network/mero-js';
import { CAPABILITIES } from './capabilities';

export type GroupRoleName = 'Admin' | 'Member' | 'ReadOnly';

/** One member row, as v1's `listGroupMembers` answered it. */
export interface GroupMember {
  identity: string;
  role: GroupRoleName;
  /** The display name the member published for the workspace, if any. */
  name?: string;
}

/** A workspace this account is in. */
export interface Namespace {
  namespaceId: string;
  name?: string;
  /** `owner` | `admin` | `member` | `guest`. */
  role?: string;
  /** How many members the org has, when it could be read. */
  memberCount?: number;
}

export type OrgRole = 'owner' | 'admin' | 'member' | 'guest';

export interface TeamView {
  teamId: string;
  name: string;
  parent: string | null;
  join: 'everyone' | 'invite';
  /** account -> is lead */
  members: Record<string, boolean>;
  readOnly: string[];
  capabilities: Record<string, number>;
  metadata: Record<string, unknown>;
  removed: string[];
}

export interface OrgView {
  orgId: string;
  name: string;
  members: Record<string, OrgRole>;
  teams: Record<string, TeamView>;
  defaultCapabilities: number;
  capabilities: Record<string, number>;
  metadata: Record<string, unknown>;
  memberMetadata: Record<string, unknown>;
  /** How the org holds its apps (core#4890); `null` on a node that does not say. */
  mode: OrgMode | null;
}

/** The name Docs is added to an organization under, in what an owner or admin is told. */
const PRODUCT_NAME = 'Mero Docs';

/** Whether `team` is an app's own team (Docs' or another app's): a top-level team marked `metadata.app`. */
export function isAppTeam(team: Pick<TeamView, 'parent' | 'metadata'>): boolean {
  const app = record(team.metadata).app;
  return !team.parent && !!record(app).package;
}

/** Where the folder's docs instance id is kept in the team's metadata. */
export const DOCS_APP_KEY = 'docsApp';
/** Where the registry instance id is kept in the org's metadata. */
export const REGISTRY_APP_KEY = 'registryApp';

const CACHE_MS = 1_500;
const JOIN = CAPABILITIES.CAN_JOIN_OPEN_SUBGROUPS;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  return Object.keys(record(value));
}

function numbers(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(record(value))) if (typeof v === 'number') out[k] = v;
  return out;
}

/** `GET /orgs/{org}` as plain records. */
export function parseOrg(orgId: string, raw: unknown): OrgView {
  const o = record(raw);
  const teams: Record<string, TeamView> = {};
  for (const [id, t] of Object.entries(record(o.teams))) {
    const team = record(t);
    const members: Record<string, boolean> = {};
    for (const [acct, lead] of Object.entries(record(team.members))) members[acct] = lead === true;
    teams[id] = {
      teamId: typeof team.teamId === 'string' ? team.teamId : id,
      name: typeof team.name === 'string' ? team.name : '',
      parent: typeof team.parent === 'string' && team.parent ? team.parent : null,
      join: team.join === 'invite' ? 'invite' : 'everyone',
      members,
      readOnly: strings(team.readOnly),
      capabilities: numbers(team.capabilities),
      metadata: record(team.metadata),
      removed: strings(team.removed),
    };
  }
  const members: Record<string, OrgRole> = {};
  for (const [acct, role] of Object.entries(record(o.members))) {
    const r = String(role).toLowerCase();
    members[acct] = (['owner', 'admin', 'member', 'guest'].includes(r) ? r : 'member') as OrgRole;
  }
  return {
    orgId,
    name: typeof o.name === 'string' ? o.name : '',
    members,
    teams,
    defaultCapabilities:
      typeof o.defaultCapabilities === 'number' ? o.defaultCapabilities : JOIN,
    capabilities: numbers(o.capabilities),
    metadata: record(o.metadata),
    memberMetadata: record(o.memberMetadata),
    mode: orgModeOf(o),
  };
}

/** The name `account` published for the workspace, if any. */
export function memberName(org: OrgView, account: string): string | undefined {
  const name = record(org.memberMetadata[account]).name;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

function orgGroupRole(role: OrgRole | undefined): GroupRoleName {
  if (role === 'owner' || role === 'admin') return 'Admin';
  if (role === 'guest') return 'ReadOnly';
  return 'Member';
}

const isOrgAdmin = (org: OrgView, account: string) =>
  org.members[account] === 'owner' || org.members[account] === 'admin';

/**
 * Who reaches `teamId`, with the role each shows: a direct row's (lead →
 * Admin, read-only → ReadOnly, else Member), and for an open team everyone who
 * reaches its parent (the organization's members at the top, guests aside),
 * unless a manager removed them there or they were denied JOIN_OPEN_TEAMS.
 */
export function teamMembers(org: OrgView, teamId: string, seen = new Set<string>()): Map<string, GroupRoleName> {
  const team = org.teams[teamId];
  const out = new Map<string, GroupRoleName>();
  if (!team || seen.has(teamId)) return out;
  seen.add(teamId);
  if (team.join === 'everyone') {
    const above: Map<string, GroupRoleName> = team.parent
      ? teamMembers(org, team.parent, seen)
      : new Map(
          Object.entries(org.members)
            .filter(([, role]) => role !== 'guest')
            .map(([acct, role]) => [acct, orgGroupRole(role)]),
        );
    for (const [acct] of above) {
      if (team.removed.includes(acct)) continue;
      const caps = org.capabilities[acct] ?? org.defaultCapabilities;
      if (!isOrgAdmin(org, acct) && (caps & JOIN) === 0) continue;
      out.set(acct, isOrgAdmin(org, acct) ? 'Admin' : 'Member');
    }
  }
  for (const [acct, lead] of Object.entries(team.members)) {
    out.set(acct, lead || isOrgAdmin(org, acct) ? 'Admin' : team.readOnly.includes(acct) ? 'ReadOnly' : 'Member');
  }
  return out;
}

/** A refusal shaped like the node's own, for a group or member this snapshot does not hold. */
function notFound(what: string): CalimeroError {
  return new NotFound(`${what} not found`);
}

type Locate = { org: string; team: string | null };

export interface CreateContextInput {
  groupId: string;
  name?: string;
  serviceName?: string;
  applicationId?: string;
  initializationParams?: unknown;
}

export class OrgAdmin {
  private readonly cache = new Map<string, { at: number; view: Promise<OrgView> }>();
  private readonly teamOrg = new Map<string, string>();
  private orgList: Promise<Namespace[]> | null = null;
  private readonly listeners = new Set<(org: string) => void>();

  constructor(
    readonly client: CalimeroClient,
    readonly self: string,
    private readonly passkey: () => PasskeyProvider,
    private readonly source: AppSource,
    private readonly sync: () => void = () => {},
  ) {}

  // ---------------------------------------------------------------- reads

  /** Who has Docs in `view`: its app team's people, else every member (no guest once the org has app teams). */
  people(view: OrgView): string[] {
    return appPeople(view as unknown as AppOrgView, sourcePackage(this.source));
  }

  /** The organization as the caller sees it; `fresh` skips the short cache. */
  org(orgId: string, fresh = false): Promise<OrgView> {
    const hit = this.cache.get(orgId);
    if (!fresh && hit && Date.now() - hit.at < CACHE_MS) return hit.view;
    const view = this.client.getOrg(orgId).then((raw) => {
      const parsed = parseOrg(orgId, raw);
      for (const id of Object.keys(parsed.teams)) this.teamOrg.set(id, orgId);
      return parsed;
    });
    this.cache.set(orgId, { at: Date.now(), view });
    view.catch(() => this.cache.delete(orgId));
    return view;
  }

  /** Called with the org id after every write this client makes to it. */
  onChange(listener: (org: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private changed(orgId: string): void {
    this.cache.delete(orgId);
    this.orgList = null;
    this.sync();
    for (const l of this.listeners) l(orgId);
  }

  /** The instances of this app the account reaches (the dev bundle, or the package). */
  instances(): Promise<AppInfo[]> {
    const filter = typeof this.source === 'string' ? { bundle: this.source } : { package: this.source.package };
    return this.client.listApps(filter);
  }

  /** Every workspace this account is in: an org holding an instance of this app. */
  listNamespaces(fresh = false): Promise<Namespace[]> {
    if (fresh || !this.orgList) {
      this.orgList = (async () => {
        const [me, apps] = await Promise.all([this.client.me(), this.instances()]);
        const withApp = new Set(apps.map((a) => a.org).filter((o): o is string => !!o));
        const orgs = (record(me).orgs ?? []) as Array<{ orgId: string; name?: string; role?: string }>;
        const rows = await Promise.all(
          orgs
            .filter((o) => withApp.has(o.orgId))
            .map(async (o) => {
              const view = await this.org(o.orgId).catch(() => null);
              return {
                namespaceId: o.orgId,
                name: o.name ?? view?.name,
                role: o.role,
                ...(view ? { memberCount: this.people(view).length } : {}),
              };
            }),
        );
        return rows
          .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.namespaceId.localeCompare(b.namespaceId));
      })();
      this.orgList.catch(() => {
        this.orgList = null;
      });
    }
    return this.orgList;
  }

  /** Whether `groupId` is an org (a workspace root) or a team, and whose. */
  async locate(groupId: string): Promise<Locate> {
    const known = this.teamOrg.get(groupId);
    if (known) return { org: known, team: groupId };
    if (this.cache.has(groupId)) return { org: groupId, team: null };
    const me = record(await this.client.me());
    const orgs = ((me.orgs ?? []) as Array<{ orgId: string }>).map((o) => o.orgId);
    if (orgs.includes(groupId)) return { org: groupId, team: null };
    for (const org of orgs) {
      const view = await this.org(org).catch(() => null);
      if (view?.teams[groupId]) return { org, team: groupId };
    }
    throw notFound(`group '${groupId}'`);
  }

  async listGroupMembers(groupId: string): Promise<{ members: GroupMember[] }> {
    const { org, team } = await this.locate(groupId);
    const view = await this.org(org);
    if (team && !view.teams[team]) throw notFound(`group '${team}'`);
    const rows = team
      ? [...teamMembers(view, team)]
      : this.people(view).map((acct) => [acct, orgGroupRole(view.members[acct])] as const);
    return {
      members: rows.map(([identity, role]) => {
        const name = memberName(view, identity);
        return name ? { identity, role, name } : { identity, role };
      }),
    };
  }

  async getMemberCapabilities(groupId: string, account: string): Promise<{ capabilities: number }> {
    const { org, team } = await this.locate(groupId);
    const view = await this.org(org);
    if (!team) {
      if (!view.members[account]) throw notFound(`member '${account}'`);
      return { capabilities: view.capabilities[account] ?? view.defaultCapabilities };
    }
    const t = view.teams[team];
    if (!t) throw notFound(`group '${team}'`);
    if (account in t.members) {
      return { capabilities: t.capabilities[account] ?? view.capabilities[account] ?? view.defaultCapabilities };
    }
    if (!teamMembers(view, team).has(account)) throw notFound(`member '${account}'`);
    // Reached through an open parent with no row of its own: an Editor there.
    return { capabilities: JOIN };
  }

  async getDefaultCapabilities(orgId: string): Promise<number> {
    return (await this.org(orgId)).defaultCapabilities;
  }

  async getGroupInfo(groupId: string): Promise<{
    groupId: string;
    namespaceId: string;
    metadata: { name: string; data: Record<string, string> };
    subgroupVisibility?: 'open' | 'restricted';
    effectiveVisibility?: 'Open' | 'Restricted';
    memberCount: number;
    contextCount: number;
  }> {
    const { org, team } = await this.locate(groupId);
    const view = await this.org(org);
    const data: Record<string, string> = {};
    const meta = team ? view.teams[team]?.metadata : view.metadata;
    if (team && !view.teams[team]) throw notFound(`group '${team}'`);
    for (const [k, v] of Object.entries(meta ?? {})) if (typeof v === 'string') data[k] = v;
    if (!team) {
      return {
        groupId,
        namespaceId: org,
        metadata: { name: view.name, data },
        memberCount: this.people(view).length,
        contextCount: data[REGISTRY_APP_KEY] ? 1 : 0,
      };
    }
    const t = view.teams[team];
    let restricted = false;
    for (let at: TeamView | undefined = t; at; at = at.parent ? view.teams[at.parent] : undefined) {
      if (at.join === 'invite') restricted = true;
    }
    return {
      groupId,
      namespaceId: org,
      metadata: { name: t.name, data },
      subgroupVisibility: t.join === 'invite' ? 'restricted' : 'open',
      effectiveVisibility: restricted ? 'Restricted' : 'Open',
      memberCount: teamMembers(view, team).size,
      contextCount: data[DOCS_APP_KEY] ? 1 : 0,
    };
  }

  async listSubgroups(groupId: string): Promise<Array<{ groupId: string }>> {
    const { org, team } = await this.locate(groupId);
    const view = await this.org(org);
    return Object.values(view.teams)
      .filter((t) => t.parent === team && !isAppTeam(t))
      .map((t) => ({ groupId: t.teamId }));
  }

  /** The app instance of a folder (its docs) or of a workspace (its registry). */
  async listGroupContexts(groupId: string): Promise<Array<{ contextId: string; name?: string }>> {
    const info = await this.getGroupInfo(groupId);
    const id = info.metadata.data[info.groupId === info.namespaceId ? REGISTRY_APP_KEY : DOCS_APP_KEY];
    return id ? [{ contextId: id }] : [];
  }

  async getMemberMetadata(orgId: string, account: string): Promise<{ name?: string } | null> {
    const view = await this.org(orgId);
    const meta = view.memberMetadata[account];
    return meta === undefined ? null : (record(meta) as { name?: string });
  }

  // ---------------------------------------------------------------- workspaces

  /**
   * A new workspace: the org and Docs' own team, open (`createAppOrg`;
   * declined, or a node without app teams, a legacy org). Its member defaults
   * and registry instance follow.
   */
  async createNamespace(input: { name: string }): Promise<{ namespaceId: string }> {
    const { orgId: namespaceId } = await createAppOrg(this.client, input.name, this.source, this.passkey, {
      mark: false,
    });
    this.changed(namespaceId);
    return { namespaceId };
  }

  async deleteNamespace(orgId: string): Promise<void> {
    await this.client.deleteOrg(orgId, this.passkey());
    this.changed(orgId);
  }

  /**
   * Leaves Docs in `orgId` (`leaveApp`): in an org that keeps its apps apart,
   * Docs' team only (`lastApp` when it was the account's last app there, for
   * the caller to offer {@link leaveOrganization}); elsewhere the organization.
   */
  async leaveNamespace(orgId: string): Promise<LeftApp> {
    const left = await leaveApp(this.client, orgId, this.source, this.passkey);
    this.changed(orgId);
    return left;
  }

  /** Leaves the organization altogether: every app in it. */
  async leaveOrganization(orgId: string): Promise<void> {
    await leaveOrg(this.client, orgId, this.passkey);
    this.changed(orgId);
  }

  async setDefaultCapabilities(orgId: string, input: { defaultCapabilities: number }): Promise<void> {
    await this.client.setCapabilities(orgId, input.defaultCapabilities, this.passkey());
    this.changed(orgId);
  }

  /** The org as read fresh: what `setOrgName` merges a name into. */
  getOrg(orgId: string): Promise<OrgView> {
    return this.org(orgId, true);
  }

  async setMemberMetadata(orgId: string, account: string, metadata: unknown): Promise<void> {
    await this.client.setMemberMetadata(orgId, account, metadata);
    this.changed(orgId);
  }

  // ---------------------------------------------------------------- folders

  async createGroupInNamespace(
    orgId: string,
    input: { visibility?: string; parentId?: string | null; name?: string },
  ): Promise<{ groupId: string }> {
    const join = input.visibility === 'restricted' || input.visibility === 'Restricted' ? 'invite' : 'everyone';
    const parent = input.parentId && input.parentId !== orgId ? input.parentId : undefined;
    const groupId = await this.client.createTeam(orgId, input.name || 'New folder', join, parent);
    this.teamOrg.set(groupId, orgId);
    this.changed(orgId);
    return { groupId };
  }

  async reparentGroup(groupId: string, input: { newParentId: string }): Promise<void> {
    const { org, team } = await this.locate(groupId);
    if (!team) throw new Error('a workspace has no parent');
    await this.client.updateTeam(org, team, { parent: input.newParentId === org ? null : input.newParentId });
    this.changed(org);
  }

  async setSubgroupVisibility(groupId: string, input: { subgroupVisibility: string }): Promise<void> {
    const { org, team } = await this.locate(groupId);
    if (!team) throw new Error('a workspace has no visibility');
    const join = input.subgroupVisibility.toLowerCase() === 'restricted' ? 'invite' : 'everyone';
    await this.client.updateTeam(org, team, { join });
    this.changed(org);
  }

  /** `name` renames the folder; `data` merges into its metadata (the docs instance id is kept). */
  async setGroupMetadata(groupId: string, input: { name?: string; data?: Record<string, unknown> }): Promise<void> {
    const { org, team } = await this.locate(groupId);
    const view = await this.org(org, true);
    if (!team) {
      await this.client.setOrgMetadata(org, { ...view.metadata, ...(input.data ?? {}) });
    } else {
      const t = view.teams[team];
      if (!t) throw notFound(`group '${team}'`);
      await this.client.updateTeam(org, team, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        metadata: { ...t.metadata, ...(input.data ?? {}) },
      });
    }
    this.changed(org);
  }

  /** Deletes the folder's team, the teams below it and their docs instances. */
  async deleteGroup(groupId: string): Promise<void> {
    const { org, team } = await this.locate(groupId);
    if (!team) throw new Error('delete the workspace instead');
    await this.client.deleteTeam(org, team);
    this.teamOrg.delete(team);
    this.changed(org);
  }

  /**
   * The app instance for a folder (`access: team`) or a workspace's registry
   * (`access: org`), recorded in the team's or org's metadata so every member
   * finds the same one.
   */
  async createContext(input: CreateContextInput): Promise<{ contextId: string }> {
    const { org, team } = await this.locate(input.groupId);
    const name = input.name || (team ? 'Folder' : 'Registry');
    // A folder's on its team; the registry on Docs' team (made first, by an
    // owner or admin, in an org whose other apps have teams), else org access.
    const access = team
      ? { kind: 'team' as const, team }
      : await orgWideAccess(this.client, org, this.source, this.passkey, PRODUCT_NAME);
    const contextId = await this.client.createApp(name, this.source, { org, access });
    await this.setGroupMetadata(input.groupId, {
      data: { [team ? DOCS_APP_KEY : REGISTRY_APP_KEY]: contextId },
    });
    return { contextId };
  }

  async deleteContext(appId: string): Promise<void> {
    await this.client.deleteApp(appId);
  }

  /** Nothing to sync on 1.0: every instance runs on its cluster's log. */
  async syncContext(_appId: string): Promise<void> {}

  // ---------------------------------------------------------------- members

  private async row(
    groupId: string,
    account: string,
    role: GroupRoleName | undefined,
    capabilities: number | undefined,
  ): Promise<void> {
    const { org, team } = await this.locate(groupId);
    if (!team) {
      if (role) {
        const orgRole = role === 'Admin' ? 'admin' : role === 'ReadOnly' ? 'guest' : 'member';
        await this.client.setMember(org, account, orgRole, this.passkey());
      }
      if (capabilities !== undefined) {
        await this.client.setCapabilities(org, capabilities, this.passkey(), { account });
      }
    } else {
      await this.client.setTeamMember(org, team, account, this.passkey(), {
        ...(role ? { role: role === 'Admin' ? 'lead' : role === 'ReadOnly' ? 'readOnly' : 'member' } : {}),
        ...(capabilities !== undefined ? { capabilities } : {}),
      });
    }
    this.changed(org);
  }

  /** Adds each member with its role; a folder row starts as an Editor's (JOIN only). */
  async addGroupMembers(
    groupId: string,
    input: { members: Array<{ identity: string; role?: string }> },
  ): Promise<void> {
    const { team } = await this.locate(groupId);
    for (const m of input.members) {
      const role = (m.role === 'Admin' || m.role === 'ReadOnly' ? m.role : 'Member') as GroupRoleName;
      await this.row(groupId, m.identity, role, team ? JOIN : undefined);
    }
  }

  /**
   * Off a folder's team; or, for the workspace, out of Docs (`removeFromApp`):
   * in an org that keeps its apps apart Docs' team only, never the org (the
   * caller clears folder rows, `removeFromFolders`); elsewhere the org.
   */
  async removeGroupMembers(groupId: string, input: { members: string[] }): Promise<void> {
    const { org, team } = await this.locate(groupId);
    for (const account of input.members) {
      if (team) await removeFromPrivateTeam(this.client, org, team, account, this.passkey);
      else await removeFromApp(this.client, org, this.source, account, this.passkey);
    }
    this.changed(org);
  }

  async updateMemberRole(groupId: string, account: string, input: { role: string }): Promise<void> {
    const role = (input.role === 'Admin' || input.role === 'ReadOnly' ? input.role : 'Member') as GroupRoleName;
    await this.row(groupId, account, role, undefined);
  }

  async setMemberCapabilities(groupId: string, account: string, input: { capabilities: number }): Promise<void> {
    await this.row(groupId, account, undefined, input.capabilities);
  }

  // ---------------------------------------------------------------- invites

  /**
   * A workspace invitation: an org invite token naming Docs' team
   * (`appInvite`), approved with the passkey. `appOnly` when it gives Docs
   * only (an org that keeps its apps apart).
   */
  async createNamespaceInvitation(orgId: string): Promise<{ token: string; appOnly: boolean }> {
    return appInvite(this.client, orgId, this.source, this.passkey);
  }

  /** A folder invitation: an org invite naming Docs' team and the folder's. */
  async createGroupInvitation(
    groupId: string,
  ): Promise<{ token: string; namespaceId: string; appOnly?: boolean }> {
    const { org, team } = await this.locate(groupId);
    const made = await appInvite(this.client, org, this.source, this.passkey, team ? { teams: [team] } : {});
    return { token: made.token, namespaceId: org, ...(made.appOnly ? { appOnly: true } : {}) };
  }

  /** Whether this account is already a member of `orgId` (its `/me` org list). */
  async isOrgMember(orgId: string): Promise<boolean> {
    const me = record(await this.client.me());
    return ((me.orgs ?? []) as Array<{ orgId: string }>).some((o) => o.orgId === orgId);
  }

  /** Redeems an invite token; answers the org it joined, when the node names it. */
  async redeemInvite(token: string): Promise<string | null> {
    const redeemed = record(await this.client.redeemInvite(token));
    this.orgList = null;
    for (const key of ['org', 'orgId']) {
      const v = redeemed[key];
      if (typeof v === 'string' && v) {
        this.changed(v);
        return v;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- blobs

  async uploadBlob(input: { data: Blob | Uint8Array; contextId: string }): Promise<{ blobId: string }> {
    const bytes =
      input.data instanceof Uint8Array ? input.data : new Uint8Array(await input.data.arrayBuffer());
    const { id } = await this.client.uploadBlob(input.contextId, bytes);
    return { blobId: id };
  }

  async getBlob(blobId: string, input: { contextId: string }): Promise<ArrayBuffer> {
    const bytes = await this.client.downloadBlob(input.contextId, blobId);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
}

export type FolderReader = Pick<OrgAdmin, 'getGroupInfo' | 'listSubgroups' | 'listGroupContexts'>;
