import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource, KeyValueStorage } from "@calimero-apps/connect";

import type { InitArgs } from "./chat";

/**
 * Where v1's admin API had namespaces, groups, contexts and invitations, the
 * 1.0 runtime has organizations and app instances:
 *
 * | v1 | here |
 * |---|---|
 * | workspace (namespace / group) | an organization |
 * | channel (a context in the group) | an app instance in the org, `org` access |
 * | private channel (restricted context, allowlist) | an instance with `accounts` access |
 * | DM (a two-member subgroup + context) | an instance with `accounts` access: the creator and the other |
 * | a member's alias in the namespace | the org's member metadata `{ name }` |
 * | group invitation | an org invite (a passkey step-up to make, redeemed by token) |
 *
 * An instance's kind travels in its name, so listing a workspace is one
 * `listApps` (no per-instance read): `#general`, `private:design`,
 * `dm:<account>:<account>` (the two accounts, sorted).
 */

export type Kind = "channel" | "private" | "dm";

export interface Workspace {
  orgId: string;
  name: string;
  role: "owner" | "admin" | "member" | "guest";
}

export interface Conversation {
  appId: string;
  org: string;
  owner: string;
  kind: Kind;
  /** The channel's name, or for a DM the other account. */
  name: string;
  /** A DM's two accounts. */
  accounts?: [string, string];
}

export interface Member {
  account: string;
  role: Workspace["role"];
  /** The name the member gave this workspace, or `""`. */
  name: string;
}

type Client = Pick<
  CalimeroClient,
  | "me"
  | "createOrg"
  | "getOrg"
  | "listApps"
  | "createApp"
  | "getApp"
  | "setAccess"
  | "deleteApp"
  | "setMemberMetadata"
  | "setMember"
  | "removeMember"
  | "invite"
  | "redeemInvite"
>;

export function channelAppName(name: string, isPrivate: boolean): string {
  return isPrivate ? `private:${name}` : `#${name}`;
}

export function dmAppName(a: string, b: string): string {
  const [x, y] = [a, b].sort();
  return `dm:${x}:${y}`;
}

/** What an instance's name says it is; `null` for one this app did not name. */
export function parseConversation(app: AppInfo, me: string): Conversation | null {
  if (!app.org) return null;
  const base = { appId: app.appId, org: app.org, owner: app.owner };
  if (app.name.startsWith("#")) return { ...base, kind: "channel", name: app.name.slice(1) };
  if (app.name.startsWith("private:")) return { ...base, kind: "private", name: app.name.slice("private:".length) };
  if (app.name.startsWith("dm:")) {
    const [, a, b] = app.name.split(":");
    if (!a || !b) return null;
    return { ...base, kind: "dm", name: a === me ? b : a, accounts: [a, b] };
  }
  return null;
}

/** The workspaces the account is in, by name. */
export async function listWorkspaces(client: Pick<Client, "me">): Promise<Workspace[]> {
  const me = await client.me();
  const orgs = Array.isArray(me.orgs) ? (me.orgs as Array<Record<string, unknown>>) : [];
  return orgs
    .map((o) => ({
      orgId: String(o.orgId),
      name: String(o.name ?? ""),
      role: String(o.role ?? "member").toLowerCase() as Workspace["role"],
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.orgId.localeCompare(b.orgId));
}

/** The workspace's members with the names they gave it, by name. */
export async function listMembers(client: Pick<Client, "getOrg">, org: string): Promise<Member[]> {
  const info = await client.getOrg(org);
  const members = (info.members ?? {}) as Record<string, string>;
  const meta = (info.memberMetadata ?? {}) as Record<string, { name?: unknown } | null>;
  return Object.entries(members)
    .map(([account, role]) => ({
      account,
      role: String(role).toLowerCase() as Workspace["role"],
      name: typeof meta[account]?.name === "string" ? String(meta[account]?.name) : "",
    }))
    .sort((a, b) => (a.name || a.account).localeCompare(b.name || b.account));
}

/** The workspace's channels and the caller's DMs in it. */
export async function listConversations(
  client: Pick<Client, "listApps">,
  source: AppSource,
  org: string,
  me: string,
): Promise<Conversation[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps = await client.listApps(filter);
  return apps
    .filter((a) => a.org === org)
    .map((a) => parseConversation(a, me))
    .filter((c): c is Conversation => c !== null)
    .sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/**
 * A new workspace: the org, the creator's name in it, and its `#general`
 * channel (v1 created the namespace and its first context the same way).
 */
export async function createWorkspace(
  client: Client,
  source: AppSource,
  name: string,
  me: string,
  username: string,
): Promise<{ org: string; general: string }> {
  const org = await client.createOrg(name);
  await client.setMemberMetadata(org, me, { name: username });
  const general = await createChannel(client, source, org, "general", false, username);
  return { org, general };
}

/** A channel in `org`: every member reaches it, or (private) only its creator until they add people. */
export function createChannel(
  client: Pick<Client, "createApp">,
  source: AppSource,
  org: string,
  name: string,
  isPrivate: boolean,
  username: string,
  description = "",
): Promise<string> {
  const initArgs: InitArgs = {
    name,
    contextType: "Channel",
    description,
    creatorUsername: username,
  };
  return client.createApp(channelAppName(name, isPrivate), source, {
    org,
    access: isPrivate ? { kind: "accounts", accounts: [] } : { kind: "org" },
    initArgs,
  });
}

/** The DM between `me` and `other` in `org`, created when there is none yet. */
export async function openDm(
  client: Pick<Client, "createApp">,
  source: AppSource,
  existing: Conversation[],
  org: string,
  me: string,
  other: string,
  username: string,
): Promise<string> {
  if (other === me) throw new Error("You cannot message yourself.");
  const found = existing.find((c) => c.kind === "dm" && c.org === org && c.accounts?.includes(other));
  if (found) return found.appId;
  const initArgs: InitArgs = { name: "", contextType: "Dm", description: "", creatorUsername: username };
  return client.createApp(dmAppName(me, other), source, {
    org,
    access: { kind: "accounts", accounts: [other] },
    initArgs,
  });
}

/** Who reaches a private channel besides its creator. */
export async function privateMembers(client: Pick<Client, "getApp">, app: string): Promise<string[]> {
  const info = await client.getApp(app);
  const access = info.access as { kind?: string; accounts?: string[] } | undefined;
  return access?.kind === "accounts" ? [...(access.accounts ?? [])] : [];
}

/** Adds (or removes) `account` to a private channel (its creator, or an org admin). */
export async function setPrivateMember(
  client: Pick<Client, "getApp" | "setAccess">,
  app: string,
  account: string,
  add: boolean,
): Promise<void> {
  const accounts = await privateMembers(client, app);
  const next = add ? [...new Set([...accounts, account])] : accounts.filter((a) => a !== account);
  await client.setAccess(app, { kind: "accounts", accounts: next });
}

/** An invitation into `org`, approved with the inviter's passkey (412 step-up). */
export function inviteToken(
  client: Pick<Client, "invite">,
  org: string,
  role: "member" | "admin" | "guest",
  passkey: PasskeyProvider,
): Promise<string> {
  return client.invite(org, role, passkey);
}

/** The link that opens this frontend with `token` to redeem. */
export function inviteLink(token: string, location: Pick<Location, "origin" | "pathname"> = window.location): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
  return url.toString();
}

const PENDING = "mero-chat:pending-invite";

/**
 * Takes `?invite=` off the address bar into storage, before anything renders: a
 * person opening a link is usually not signed in yet, and the token has to
 * survive the passkey sign-up. Redeemed (and dropped) once a session exists.
 */
export function captureInvite(storage: KeyValueStorage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  try {
    storage.setItem(PENDING, token);
  } catch {
    return;
  }
  url.searchParams.delete("invite");
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): string | null {
  try {
    return storage.getItem(PENDING);
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
