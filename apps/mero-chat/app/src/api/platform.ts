/**
 * Workspaces, channels, DMs and members on Calimero 1.0 — what v1 kept in
 * namespaces, subgroups and contexts.
 *
 * | v1 | here |
 * |---|---|
 * | a workspace: a namespace of the app | an **organization** (`createOrg`); its id is the "group id" |
 * | a channel: a subgroup (open or restricted) with one context in it | an **app instance** of chat in the org; its id is both the "subgroup" and the "context" id |
 * | an open subgroup | access `team` on chat's **app team** (core#4890): everyone in Chat in this workspace reaches it; in an org without one (legacy, a dev bundle, an older node) access `org`, every member |
 * | a restricted subgroup and its members | access `accounts`: the instance's owner and the accounts listed |
 * | a DM: a restricted subgroup of two, alias `DM_CONTEXT_…` | an instance named `DM_CONTEXT_…`, access `accounts` [the other person] |
 * | namespace members and roles | org members: `owner`/`admin` → Admin, `member` → Member, `guest` → ReadOnly |
 * | member metadata `{ name }` | org member metadata `{ name }` |
 * | a per-context member key | the account: one id everywhere |
 * | namespace invitation (signed payload in a link) | an org **invite token** naming chat's app team (a passkey step-up), redeemed after sign-in |
 * | capability bits | the org's capability bits (the same positions: create, invite, join open, create/delete subgroup ↔ team, visibility) |
 *
 * v1 made a channel in steps (create the subgroup, set its visibility, add
 * members, create its context). A 1.0 instance is made in one call that
 * needs all of that, so the first steps are kept as a **pending channel**
 * here and the instance is created when the context is.
 */
import { passkeyConfirm, type AppInfo, type CalimeroClient, type OrgMode } from "@calimero-network/mero-js";
import {
  adoptAppTeam,
  appInvite,
  appPeople,
  appTarget,
  appTeamIdIn,
  appTeamMembers,
  createAppOrg,
  leaveApp,
  leaveOrg,
  listAppInfos,
  orgsWithApp,
  orgWideAccess,
  otherOrgs,
  removeFromApp,
  type AppInviteToken,
  type AppOrgView,
  type OrgTeamView,
  type OtherOrg,
} from "@calimero-apps/connect";

import { after, chatSource, getAccountId, getClient, passkey } from "./calimero";

export type Visibility = "open" | "restricted";

/** An app's access rule, as the node stores it. */
export type Access =
  | { kind: "owner" }
  | { kind: "org" }
  | { kind: "public" }
  | { kind: "accounts"; accounts: string[] }
  | { kind: "team"; team: string };

/** What `GET /apps/{app}` answers that this app reads. */
export interface AppRecord {
  appId: string;
  name: string;
  owner: string;
  org: string | null;
  access: Access;
  metadata: Record<string, unknown> | null;
}

/** What `GET /orgs/{org}` answers that this app reads. */
export interface OrgRecord {
  orgId: string;
  name: string;
  /** account → `owner` | `admin` | `member` | `guest`. */
  members: Record<string, string>;
  defaultCapabilities: number;
  capabilities: Record<string, number>;
  metadata: Record<string, unknown> | null;
  memberMetadata: Record<string, Record<string, unknown> | null>;
  /** The teams the caller sees: `members` maps an account to whether it leads. */
  teams: Record<string, ChatOrgTeam>;
  /** How the org holds its apps (core#4890); `null` on a node that does not say. */
  mode: OrgMode | null;
}

/** A team in {@link OrgRecord}. */
export interface ChatOrgTeam extends OrgTeamView {
  metadata?: unknown;
}

function client(): CalimeroClient {
  return getClient();
}

/** Runs `fn`, keeping the stored session current (refresh tokens are single-use). */
export async function run<T>(fn: (c: CalimeroClient) => Promise<T>): Promise<T> {
  try {
    return await fn(client());
  } finally {
    after();
  }
}

// ── small caches (a channel list reads every channel's record) ───────────────

const TTL_MS = 5_000;
const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as Promise<T>;
  const value = load();
  cache.set(key, { at: Date.now(), value });
  value.catch(() => cache.delete(key));
  return value;
}

/** Forget what was read about `id` (after a write to it), or everything. */
export function invalidate(id?: string): void {
  if (!id) {
    cache.clear();
    return;
  }
  for (const key of [...cache.keys()]) if (key.endsWith(`:${id}`) || key.startsWith("apps:")) cache.delete(key);
}

// ── reads ────────────────────────────────────────────────────────────────────

function asAccess(value: unknown): Access {
  const v = (value ?? {}) as { kind?: unknown; accounts?: unknown; team?: unknown };
  switch (v.kind) {
    case "org":
      return { kind: "org" };
    case "public":
      return { kind: "public" };
    case "accounts":
      return {
        kind: "accounts",
        accounts: Array.isArray(v.accounts) ? v.accounts.filter((a): a is string => typeof a === "string") : [],
      };
    case "team":
      return { kind: "team", team: String(v.team ?? "") };
    default:
      return { kind: "owner" };
  }
}

export function getAppRecord(app: string): Promise<AppRecord> {
  return cached(`app:${app}`, async () => {
    const raw = (await run((c) => c.apps.get({ app }))) as Record<string, unknown>;
    const metadata = raw.metadata && typeof raw.metadata === "object" ? (raw.metadata as Record<string, unknown>) : null;
    return {
      appId: String(raw.appId ?? app),
      name: String(raw.name ?? ""),
      owner: String(raw.owner ?? ""),
      org: typeof raw.org === "string" ? raw.org : null,
      access: asAccess(raw.access),
      metadata,
    };
  });
}

export function getOrgRecord(org: string): Promise<OrgRecord> {
  return cached(`org:${org}`, async () => {
    const raw = (await run((c) => c.orgs.get({ org }))) as unknown as Record<string, unknown>;
    const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
    return {
      orgId: String(raw.orgId ?? org),
      name: String(raw.name ?? ""),
      members: obj(raw.members) as Record<string, string>,
      defaultCapabilities: typeof raw.defaultCapabilities === "number" ? raw.defaultCapabilities : 0,
      capabilities: obj(raw.capabilities) as Record<string, number>,
      metadata: raw.metadata && typeof raw.metadata === "object" ? (raw.metadata as Record<string, unknown>) : null,
      memberMetadata: obj(raw.memberMetadata) as Record<string, Record<string, unknown> | null>,
      teams: obj(raw.teams) as Record<string, ChatOrgTeam>,
      mode: raw.mode === "legacy" || raw.mode === "standalone" || raw.mode === "shared" ? raw.mode : null,
    };
  });
}

// ── chat's app team (core#4890) ─────────────────────────────────────────────

/**
 * The package chat's app team is marked with; `null` under a raw dev bundle
 * (`pnpm dev:local`), which no package ships, so it has no app team and every
 * workspace reads as legacy there.
 */
export function chatPackage(): string | null {
  const source = chatSource();
  return typeof source === "string" ? null : source.package;
}

/** Chat's app team in `org` (a top-level team marked with chat's package), as the caller sees the org. */
export function chatTeamId(org: OrgRecord): string | null {
  return appTeamIdIn(org as AppOrgView, chatPackage());
}

/** The name Chat is added to an organization under, in what an owner or admin is told. */
const CHAT_TITLE = "Hyperfeed Chat";

/**
 * Who is in Chat in this workspace: chat's app team, else (no app team) every
 * org member, except a guest once the org has app teams (core gives them only
 * the apps they are invited to).
 *
 * In an org with app teams where the caller sees no team of chat's, nobody is
 * (the caller included): core shows a closed team only to its members and the
 * org's admins, so chat's team is closed to them (someone Calimero Home took
 * out of Chat), or chat has none there yet. Reading every org member there
 * kept that person in a workspace they had lost.
 */
export function chatMembers(org: OrgRecord): string[] {
  return appPeople(org as AppOrgView, chatPackage());
}

/** Whether the signed-in account has Chat in a workspace ({@link chatAccessIn}). */
export type ChatAccess =
  | { kind: "member" }
  /** In the org, but not in Chat there: taken off its team, or no row once an admin closed it. */
  | { kind: "closed"; orgName: string }
  /** The workspace could not be read (out of the org, a failure): says nothing about Chat. */
  | { kind: "unknown" };

/**
 * Chat's verdict for `self` in `org`, from what `getOrg` showed them and
 * whether they still reach any chat instance there. Closed only in an org
 * with app teams, where they are in the org, not among chat's people
 * ({@link chatMembers}: off its open team, or a closed team core does not
 * show them) and reach no channel there either (a private channel that still
 * lists them keeps the workspace open). A legacy org is everyone's.
 */
export function chatAccessFrom(org: OrgRecord, self: string, reachesAChannel: boolean): ChatAccess {
  if (!self || !(self in org.members)) return { kind: "unknown" };
  if (org.mode !== "standalone" && org.mode !== "shared") return { kind: "member" };
  if (chatMembers(org).includes(self) || reachesAChannel) return { kind: "member" };
  return { kind: "closed", orgName: org.name.trim() || "this organization" };
}

/** {@link chatAccessFrom} for the signed-in account in workspace `org`, read from the cluster. */
export async function chatAccessIn(org: string, self: string = getAccountId()): Promise<ChatAccess> {
  try {
    const [record, apps] = await Promise.all([getOrgRecord(org), listChatApps()]);
    return chatAccessFrom(record, self, apps.some((a) => a.org === org));
  } catch {
    return { kind: "unknown" };
  }
}

/**
 * Gives chat its own app team in `org` (`adoptAppTeam`, owner or admin, one
 * passkey): its organization-access channels move onto it, and everyone who
 * reaches them keeps them. The team is open (everyone in the org has Chat)
 * unless the org is shared already, where it is closed like the others: who
 * else gets Chat is then an admin's choice, here or in Calimero Home. Another
 * app's team is never closed from here. `null` without a package (a dev bundle).
 */
export async function adoptChatTeam(org: string): Promise<string | null> {
  const made = await run((c) => adoptAppTeam(c, org, chatSource(), passkey));
  invalidate(org);
  invalidate();
  return made;
}

/**
 * The access an open channel gets in `org`: chat's app team (`orgWideAccess`).
 * An org with app teams but none for chat gets one first, which only an owner
 * or admin may make. A legacy org keeps organization access: moving it onto
 * an app team is an admin's choice (Calimero Home), never forced.
 */
async function openAccess(org: string): Promise<Access> {
  const record = await getOrgRecord(org);
  const team = chatTeamId(record);
  if (team) return { kind: "team", team };
  const access = await run((c) => orgWideAccess(c, org, chatSource(), passkey, CHAT_TITLE));
  if (access.kind === "team") {
    invalidate(org);
    invalidate();
  }
  return access;
}

/** The orgs this account is in (`/me`). */
export async function myOrgs(): Promise<Array<{ orgId: string; name: string; role: string }>> {
  const me = (await run((c) => c.auth.me())) as { orgs?: Array<{ orgId: string; name: string; role: string }> };
  return me.orgs ?? [];
}

/**
 * The workspaces: the orgs this account is in that hold a chat instance. An
 * org made for another app (a Mero Blocks world) is not one, and is offered
 * only through "Connect to an existing organization" ({@link otherChatOrgs}).
 */
export function chatOrgs(): Promise<Array<{ orgId: string; name: string; role: string }>> {
  return cached("orgs:chat", () => run((c) => orgsWithApp(c, chatSource())));
}

/** The account's other orgs where chat may be added, with what each holds. */
export function otherChatOrgs(): Promise<OtherOrg[]> {
  return run((c) => otherOrgs(c, chatSource()));
}

/** Every chat instance this account reaches (the dev bundle's, or the package's). */
export function listChatApps(): Promise<AppInfo[]> {
  const source = chatSource();
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  return cached(`apps:${JSON.stringify(filter)}`, () => run((c) => listAppInfos(c, filter)));
}

/** Whether `id` is an org this account is in (else it is read as an app). */
export async function isOrg(id: string): Promise<boolean> {
  if (!id) return false;
  if (pendingChannels.has(id)) return false;
  const orgs = await cached("orgs:me", myOrgs);
  return orgs.some((o) => o.orgId === id);
}

/** v1's member role, from an org role. */
export function memberRole(orgRole: string | undefined): "Admin" | "Member" | "ReadOnly" {
  if (orgRole === "owner" || orgRole === "admin") return "Admin";
  if (orgRole === "guest") return "ReadOnly";
  return "Member";
}

/** The name an account set for the workspace, if any. */
export function memberName(org: OrgRecord, account: string): string | undefined {
  const name = org.memberMetadata[account]?.name;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

/**
 * Who reaches channel `app`: everyone in chat's app team (or every org member
 * where there is none), or its owner and the listed accounts.
 */
export async function appMembers(app: AppRecord): Promise<string[]> {
  if (app.access.kind === "accounts") {
    return [...new Set([app.owner, ...app.access.accounts])];
  }
  if (app.access.kind === "org" && app.org) {
    // Everyone in the org, but no guest once it has app teams.
    return appPeople((await getOrgRecord(app.org)) as AppOrgView, null);
  }
  if (app.access.kind === "team" && app.org) {
    const org = await getOrgRecord(app.org);
    return appTeamMembers(org as AppOrgView, app.access.team, org.mode);
  }
  return [app.owner];
}

/** Open: the workspace's (its org, or chat's app team on it); restricted: the listed accounts. */
export function visibilityOf(access: Access): Visibility {
  return access.kind === "org" || access.kind === "public" || access.kind === "team" ? "open" : "restricted";
}

// ── writes ───────────────────────────────────────────────────────────────────

/** Sets a channel's access: open (the org) or restricted to `accounts` (besides its owner). */
export async function setAppAccess(app: string, access: Access): Promise<void> {
  await run((c) => c.apps.access({ app, access }));
  invalidate(app);
}

/** Adds (or removes) accounts on a restricted channel. An open channel already reaches every member. */
export async function changeAppAccounts(app: string, add: string[], remove: string[] = []): Promise<void> {
  const record = await getAppRecord(app);
  if (record.access.kind !== "accounts") return;
  const next = new Set(record.access.accounts);
  for (const a of add) if (a && a !== record.owner) next.add(a);
  for (const a of remove) next.delete(a);
  await setAppAccess(app, { kind: "accounts", accounts: [...next] });
}

export async function setVisibility(app: string, mode: Visibility): Promise<void> {
  const record = await getAppRecord(app);
  if (visibilityOf(record.access) === mode) return;
  if (mode === "open") {
    await setAppAccess(app, record.org ? await openAccess(record.org) : { kind: "org" });
  } else {
    // A channel made private keeps nobody but its owner until people are added.
    await setAppAccess(app, { kind: "accounts", accounts: [] });
  }
}

// ── pending channels (v1's subgroup steps before its context) ────────────────

interface PendingChannel {
  org: string;
  name: string;
  visibility: Visibility;
  accounts: string[];
  /** Set once the instance exists. */
  appId?: string;
}

const pendingChannels = new Map<string, PendingChannel>();
let pendingSeq = 0;

export function createPendingChannel(org: string, name: string, visibility: Visibility): string {
  const id = `pending:${Date.now().toString(36)}:${(pendingSeq += 1)}`;
  pendingChannels.set(id, { org, name, visibility, accounts: [] });
  return id;
}

export function pendingChannel(id: string): PendingChannel | undefined {
  return pendingChannels.get(id);
}

/** The init arguments v1 passed as `initializationParams`, in the ABI's names. */
export function initArgsFrom(params: Record<string, unknown>): Record<string, unknown> {
  const s = (v: unknown) => (typeof v === "string" ? v : null);
  const type = s(params.context_type) ?? s(params.contextType);
  return {
    name: s(params.name),
    contextType: type === "Dm" ? "Dm" : "Channel",
    description: s(params.description),
    creatorUsername: s(params.creator_username) ?? s(params.creatorUsername),
  };
}

/**
 * Creates the chat instance for a channel or DM: from a pending channel (v1's
 * subgroup) or straight into an org.
 */
export async function createChatApp(
  groupId: string,
  name: string | undefined,
  initializationParams: Record<string, unknown>,
): Promise<string> {
  const pending = pendingChannels.get(groupId);
  if (pending?.appId) return pending.appId;
  const org = pending?.org ?? groupId;
  const title = (pending?.name || name || String(initializationParams.name ?? "") || "channel").trim();
  const access: Access =
    (pending?.visibility ?? "open") === "open"
      ? await openAccess(org)
      : { kind: "accounts", accounts: pending?.accounts ?? [] };
  const appId = await run((c) =>
    c.apps.create({ name: title, ...appTarget(chatSource()), org, access, initArgs: initArgsFrom(initializationParams) }).then((r) => r.appId),
  );
  if (pending) pending.appId = appId;
  invalidate();
  return appId;
}

// ── orgs ─────────────────────────────────────────────────────────────────────

/**
 * A new workspace (`createAppOrg`): an org whose members get `capabilities`
 * (a passkey step-up) and chat's own app team, open, so everyone in it has
 * Chat, its invites name the team, and should the org later hold other apps,
 * Calimero Home can keep Chat's people apart from theirs. Neither step fails
 * the workspace: declined, or a node without app teams, it is a legacy one.
 * Not marked: a workspace is listed once it holds #general.
 */
export async function createOrg(name: string, capabilities?: number): Promise<string> {
  const made = await run((c) => createAppOrg(c, name, chatSource(), passkey, { mark: false }));
  invalidate();
  if (capabilities !== undefined) {
    await setCapabilities(made.orgId, capabilities).catch((e: unknown) => {
      console.warn("createOrg: member capabilities not set", e);
    });
  }
  return made.orgId;
}

export async function setCapabilities(org: string, capabilities: number, account?: string): Promise<void> {
  await run((c) =>
    c.orgs.capabilities({ org, capabilities, ...(account ? { account } : {}) }, { confirm: passkeyConfirm(passkey()) }),
  );
  invalidate(org);
}

export async function setMemberRole(org: string, account: string, role: "admin" | "member" | "guest"): Promise<void> {
  await run((c) => c.orgs.setMember({ org, account, role }, { confirm: passkeyConfirm(passkey()) }));
  invalidate(org);
}


/** Puts an org member into Chat: a row on chat's app team (its managers; a passkey step-up). */
export async function addToChat(org: string, account: string): Promise<void> {
  const team = chatTeamId(await getOrgRecord(org));
  if (!team) return;
  await run((c) => c.orgs.teamSetMember({ org, team, account }, { confirm: passkeyConfirm(passkey()) }));
  invalidate(org);
}

/** Takes `account` off the private channels and DMs in `org` that list them and this account may change. */
async function offPrivateChannels(org: string, account: string): Promise<void> {
  const apps = (await listChatApps().catch(() => [] as AppInfo[])).filter((a) => a.org === org);
  for (const app of apps) {
    const record = await getAppRecord(app.appId).catch(() => null);
    if (record?.access.kind !== "accounts" || !record.access.accounts.includes(account)) continue;
    await changeAppAccounts(app.appId, [], [account]).catch((e: unknown) => {
      console.warn(`removeFromChat: ${app.appId} still lists ${account}`, e);
    });
  }
}

/**
 * Removes a person from Chat in `org` (`removeFromApp`, a passkey step-up).
 * In a shared org that is Chat only: off chat's app team, and off the private
 * channels and DMs listed for them that this account may change (their access
 * names accounts, so the team does not carry them). Elsewhere (standalone,
 * legacy, a dev bundle) it is out of the organization, as before.
 */
export async function removeFromChat(org: string, account: string): Promise<"app" | "org"> {
  const left = await run((c) => removeFromApp(c, org, chatSource(), account, passkey));
  invalidate(org);
  if (left === "app") await offPrivateChannels(org, account);
  invalidate();
  return left;
}

/**
 * The signed-in account leaves Chat in `org` (`leaveApp`): in a shared org
 * chat's team only, with `lastApp` set when it was their last app there (the
 * caller offers {@link leaveChatOrg}); elsewhere the organization, as before.
 */
export async function leaveChat(org: string): Promise<{ left: "app" | "org"; lastApp: boolean }> {
  const left = await run((c) => leaveApp(c, org, chatSource(), passkey));
  invalidate(org);
  invalidate();
  return left;
}

/** The signed-in account leaves `org` altogether: every app in it. */
export async function leaveChatOrg(org: string): Promise<void> {
  await run((c) => leaveOrg(c, org, passkey));
  invalidate(org);
  invalidate();
}

export async function deleteOrg(org: string): Promise<void> {
  await run((c) => c.orgs.delete({ org }, { confirm: passkeyConfirm(passkey()) }));
  invalidate();
}

export async function setMemberName(org: string, account: string, name: string): Promise<void> {
  await run((c) => c.orgs.memberMetadata({ org, account, metadata: { name } }));
  invalidate(org);
}

export async function setOrgName(org: string, name: string): Promise<void> {
  const current = await getOrgRecord(org).catch(() => null);
  await run((c) => c.orgs.metadata({ org, metadata: { ...(current?.metadata ?? {}), name } }));
  invalidate(org);
}

/**
 * An invite into `org` as a member, naming chat's app team, so it gives Chat
 * and no other app of a shared org (`appInvite`, `appOnly`): a passkey step-up
 * for the inviter. An org-wide invite where the org has no app teams (legacy,
 * an older node) or under a dev bundle.
 */
export function inviteToken(org: string): Promise<AppInviteToken> {
  return run((c) => appInvite(c, org, chatSource(), passkey));
}

/** Redeems an invite token; answers the org it joined. */
export async function redeemInvite(token: string): Promise<string | null> {
  const redeemed = (await run((c) => c.orgs.inviteRedeem({ token }))) as Record<string, unknown>;
  invalidate();
  for (const key of ["org", "orgId"]) {
    const v = redeemed[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

export function me(): string {
  return getAccountId();
}
