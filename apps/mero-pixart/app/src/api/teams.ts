import { ORG_CAPABILITIES, type AppInfo, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource, KeyValueStorage } from "@calimero-apps/connect";

import { APP_NAME } from "../config";

/**
 * v1 → Calimero 1.0, for this app:
 *
 * | v1 | here |
 * |---|---|
 * | a team: a namespace of the app | an **organization** (`createOrg`) |
 * | a project: a subgroup + the document context bound to it | an **app instance** in the org (`createApp(name, source, { org })`) |
 * | the project's name: the subgroup alias, then `init(name, …)` | the instance's `name`, and the document's (`updateDocument`) |
 * | a team invitation: a signed payload in a deflate+base58 link | an **org invite** token in `?invite=` (`invite` is a passkey step-up; `redeemInvite` after sign-in) |
 * | the name a person set for the whole team: namespace member metadata | org **member metadata** `{ name }` |
 * | joining a project context, waiting for it to sync | nothing: every member of the org reaches its instances, and nothing has to replicate first |
 * | team governance roles (Admin / Member) | org roles (`owner`, `admin`, `member`, `guest`) |
 */

/** A team this account is in. */
export interface TeamRow {
  /** The org id. */
  groupId: string;
  name: string;
  /** `owner` | `admin` | `member` | `guest`. */
  role: string;
}

/** A project: an instance of this app in the team's org. */
export interface ProjectRow {
  /** The app instance id (v1's context id). */
  contextId: string;
  name: string;
  /** The account that created the instance: it (or a team admin) may delete it. */
  owner: string;
}

interface MeOrgs {
  orgs?: Array<{ orgId: string; name: string; role: string }>;
}

/** The instances of this app (the dev bundle, or the package) the account reaches. */
export async function listInstances(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  return client.listApps(filter);
}

/** Every team (org) this account is in, by name. */
export async function listTeams(client: Pick<CalimeroClient, "me">): Promise<TeamRow[]> {
  const me = (await client.me()) as MeOrgs;
  return (me.orgs ?? [])
    .map((o) => ({ groupId: o.orgId, name: o.name, role: o.role }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.groupId.localeCompare(b.groupId));
}

/** The projects in `org`, by name. */
export async function listProjects(
  client: Pick<CalimeroClient, "listApps">,
  source: AppSource,
  org: string,
): Promise<ProjectRow[]> {
  return (await listInstances(client, source))
    .filter((a) => a.org === org)
    .map((a) => ({ contextId: a.appId, name: a.name, owner: a.owner }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.contextId.localeCompare(b.contextId));
}

/**
 * What a member may do unless an admin sets otherwise, as v1 set it on a new
 * namespace: create projects and invite people (and join open teams).
 */
export const MEMBER_DEFAULTS =
  ORG_CAPABILITIES.CREATE_APP | ORG_CAPABILITIES.INVITE_MEMBERS | ORG_CAPABILITIES.JOIN_OPEN_TEAMS;

/**
 * A new team: an org whose members may create projects and invite. Setting the
 * defaults is a passkey step-up; refused, the org stays (only its owner and
 * admins can then create projects and invite).
 */
export async function createTeam(
  client: Pick<CalimeroClient, "createOrg" | "setCapabilities">,
  name: string,
  passkey: () => PasskeyProvider,
): Promise<{ groupId: string; warning: string | null }> {
  const groupId = await client.createOrg(name);
  try {
    await client.setCapabilities(groupId, MEMBER_DEFAULTS, passkey());
    return { groupId, warning: null };
  } catch {
    return {
      groupId,
      warning: "Team created, but people you invite will not be able to create projects or invite others.",
    };
  }
}

/** The caller may delete the team (owner or admin), else only leave it. */
export function isTeamAdmin(role: string | undefined | null): boolean {
  return role === "owner" || role === "admin";
}

// ── members ──────────────────────────────────────────────────────────────────

/** The parts of `GET /orgs/{org}` the screens read. */
export interface OrgMembers {
  name: string;
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> the name they set for the team, where one is set. */
  names: Map<string, string>;
}

export async function readMembers(client: Pick<CalimeroClient, "getOrg">, org: string): Promise<OrgMembers> {
  const o = (await client.getOrg(org)) as Record<string, unknown>;
  const members = (o.members ?? {}) as Record<string, string>;
  const meta = (o.memberMetadata ?? {}) as Record<string, unknown>;
  const names = new Map<string, string>();
  for (const [account, value] of Object.entries(meta)) {
    const name = (value as { name?: unknown } | null)?.name;
    if (typeof name === "string" && name.trim()) names.set(account, name.trim());
  }
  return { name: typeof o.name === "string" ? o.name : "", roles: new Map(Object.entries(members)), names };
}

/** Publishes the name `account` goes by across the team (org member metadata). */
export async function publishTeamName(
  client: Pick<CalimeroClient, "setMemberMetadata">,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  await client.setMemberMetadata(org, account, { name });
}

// ── invitations ──────────────────────────────────────────────────────────────

/**
 * The link that opens this frontend with `token` to redeem; with `project`,
 * the joiner lands in that project instead of on the team's project list.
 */
export function inviteLink(
  token: string,
  project?: string,
  location: Pick<Location, "origin" | "pathname"> = window.location,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
  if (project) url.searchParams.set("project", project);
  return url.toString();
}

export interface PendingInvite {
  token: string;
  /** The project the link lands in, when it names one. */
  project: string | null;
}

const PENDING = `${APP_NAME}:pending-invite`;

/**
 * Takes `?invite=` (and `&project=`) off the address bar into storage, before
 * anything renders: a person opening a link is usually not signed in yet, and
 * the token must survive the sign-up. Redeemed (and dropped) once a session
 * exists and the person says yes.
 */
export function captureInvite(storage: KeyValueStorage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  const pending: PendingInvite = { token, project: url.searchParams.get("project") };
  try {
    storage.setItem(PENDING, JSON.stringify(pending));
  } catch {
    return;
  }
  url.searchParams.delete("invite");
  url.searchParams.delete("project");
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): PendingInvite | null {
  try {
    const raw = storage.getItem(PENDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingInvite>;
    return typeof parsed.token === "string" && parsed.token
      ? { token: parsed.token, project: typeof parsed.project === "string" ? parsed.project : null }
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
  for (const key of ["org", "orgId"]) {
    const v = redeemed[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}
