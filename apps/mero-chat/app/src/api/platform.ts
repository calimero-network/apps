/**
 * Workspaces, channels, DMs and members on Calimero 1.0 — what v1 kept in
 * namespaces, subgroups and contexts.
 *
 * | v1 | here |
 * |---|---|
 * | a workspace: a namespace of the app | an **organization** (`createOrg`); its id is the "group id" |
 * | a channel: a subgroup (open or restricted) with one context in it | an **app instance** of chat in the org; its id is both the "subgroup" and the "context" id |
 * | an open subgroup | access `org`: every member of the workspace reaches it |
 * | a restricted subgroup and its members | access `accounts`: the instance's owner and the accounts listed |
 * | a DM: a restricted subgroup of two, alias `DM_CONTEXT_…` | an instance named `DM_CONTEXT_…`, access `accounts` [the other person] |
 * | namespace members and roles | org members: `owner`/`admin` → Admin, `member` → Member, `guest` → ReadOnly |
 * | member metadata `{ name }` | org member metadata `{ name }` |
 * | a per-context member key | the account: one id everywhere |
 * | namespace invitation (signed payload in a link) | an org **invite token** (a passkey step-up), redeemed after sign-in |
 * | capability bits | the org's capability bits (the same positions: create, invite, join open, create/delete subgroup ↔ team, visibility) |
 *
 * v1 made a channel in steps (create the subgroup, set its visibility, add
 * members, create its context). A 1.0 instance is made in one call that
 * needs all of that, so the first steps are kept as a **pending channel**
 * here and the instance is created when the context is.
 */
import type { AppInfo, CalimeroClient } from "@calimero-network/mero-js";

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
    const raw = (await run((c) => c.getApp(app))) as Record<string, unknown>;
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
    const raw = (await run((c) => c.getOrg(org))) as unknown as Record<string, unknown>;
    const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
    return {
      orgId: String(raw.orgId ?? org),
      name: String(raw.name ?? ""),
      members: obj(raw.members) as Record<string, string>,
      defaultCapabilities: typeof raw.defaultCapabilities === "number" ? raw.defaultCapabilities : 0,
      capabilities: obj(raw.capabilities) as Record<string, number>,
      metadata: raw.metadata && typeof raw.metadata === "object" ? (raw.metadata as Record<string, unknown>) : null,
      memberMetadata: obj(raw.memberMetadata) as Record<string, Record<string, unknown> | null>,
    };
  });
}

/** The orgs this account is in (`/me`). */
export async function myOrgs(): Promise<Array<{ orgId: string; name: string; role: string }>> {
  const me = (await run((c) => c.me())) as { orgs?: Array<{ orgId: string; name: string; role: string }> };
  return me.orgs ?? [];
}

/** Every chat instance this account reaches (the dev bundle's, or the package's). */
export function listChatApps(): Promise<AppInfo[]> {
  const source = chatSource();
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  return cached(`apps:${JSON.stringify(filter)}`, () => run((c) => c.listApps(filter)));
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

/** Who reaches channel `app`: every org member, or its owner and the listed accounts. */
export async function appMembers(app: AppRecord): Promise<string[]> {
  if (app.access.kind === "accounts") {
    return [...new Set([app.owner, ...app.access.accounts])];
  }
  if (app.access.kind === "org" && app.org) {
    return Object.keys((await getOrgRecord(app.org)).members);
  }
  return [app.owner];
}

export function visibilityOf(access: Access): Visibility {
  return access.kind === "org" || access.kind === "public" ? "open" : "restricted";
}

// ── writes ───────────────────────────────────────────────────────────────────

/** Sets a channel's access: open (the org) or restricted to `accounts` (besides its owner). */
export async function setAppAccess(app: string, access: Access): Promise<void> {
  await run((c) => c.setAccess(app, access as unknown as Record<string, unknown>));
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
    await setAppAccess(app, { kind: "org" });
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
      ? { kind: "org" }
      : { kind: "accounts", accounts: pending?.accounts ?? [] };
  const appId = await run((c) =>
    c.createApp(title, chatSource(), {
      org,
      access: access as unknown as Record<string, unknown>,
      initArgs: initArgsFrom(initializationParams),
    }),
  );
  if (pending) pending.appId = appId;
  invalidate();
  return appId;
}

// ── orgs ─────────────────────────────────────────────────────────────────────

export async function createOrg(name: string): Promise<string> {
  const org = await run((c) => c.createOrg(name));
  invalidate();
  return org;
}

export async function setCapabilities(org: string, capabilities: number, account?: string): Promise<void> {
  await run((c) => c.setCapabilities(org, capabilities, passkey(), account ? { account } : {}));
  invalidate(org);
}

export async function setMemberRole(org: string, account: string, role: "admin" | "member" | "guest"): Promise<void> {
  await run((c) => c.setMember(org, account, role, passkey()));
  invalidate(org);
}

export async function removeOrgMember(org: string, account: string): Promise<void> {
  await run((c) => c.removeMember(org, account, passkey()));
  invalidate();
}

export async function deleteOrg(org: string): Promise<void> {
  await run((c) => c.deleteOrg(org, passkey()));
  invalidate();
}

export async function setMemberName(org: string, account: string, name: string): Promise<void> {
  await run((c) => c.setMemberMetadata(org, account, { name }));
  invalidate(org);
}

export async function setOrgName(org: string, name: string): Promise<void> {
  const current = await getOrgRecord(org).catch(() => null);
  await run((c) => c.setOrgMetadata(org, { ...(current?.metadata ?? {}), name }));
  invalidate(org);
}

/** An invite into `org` as a member: a passkey step-up for the inviter. */
export function inviteToken(org: string): Promise<string> {
  return run((c) => c.invite(org, "member", passkey()));
}

/** Redeems an invite token; answers the org it joined. */
export async function redeemInvite(token: string): Promise<string | null> {
  const redeemed = (await run((c) => c.redeemInvite(token))) as Record<string, unknown>;
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
