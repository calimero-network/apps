import { CalimeroError, ORG_CAPABILITIES, type AppInfo, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource, KeyValueStorage } from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";

import { APP } from "./session";

/**
 * Teams, their projects, members and invitations, on Calimero 1.0.
 *
 * | v1 | here |
 * |---|---|
 * | a team: a namespace of the app | an **organization** (`createOrg`) |
 * | a project: a subgroup of the namespace holding one context | an **app instance** in the org (`createApp(name, source, { org, initArgs })`) |
 * | the project's name: context / subgroup name | the instance's `name` (and the document's own name) |
 * | the team's name: group metadata | the org's `name` |
 * | a namespace invitation (signed payload in a deflate+base58 link) | an **org invite** token in `?invite=` (`invite` is a passkey step-up; `redeemInvite` after sign-in) |
 * | `Admin` / `Member` group roles | org roles `owner`/`admin`/`member`/`guest` |
 * | join a context, join sync | gone: an instance is on the cluster, nothing to join or sync |
 * | a person's name on the namespace (`@calimero-apps/names`) | their org member metadata `{ name }` |
 */

/** A team this account is in. */
export interface Team {
  /** The org id. Named for what the screens called it. */
  groupId: string;
  name: string;
  /** `owner` | `admin` | `member` | `guest`. */
  role: string;
}

/** A project: an instance of this app in a team's org. */
export interface ProjectEntry {
  /** The app instance id. */
  contextId: string;
  name: string;
  /** The account that created it. */
  owner: string;
}

interface MeOrgs {
  orgs?: Array<{ orgId: string; name: string; role: string }>;
}

/**
 * Every org this account is in. Orgs are the platform's teams, not this app's
 * alone: a team made in another Calimero 1.0 app shows here too, and can hold
 * projects.
 */
export async function listTeams(client: Pick<CalimeroClient, "me">): Promise<Team[]> {
  const me = (await client.me()) as MeOrgs;
  return (me.orgs ?? [])
    .map((o) => ({ groupId: o.orgId, name: o.name, role: o.role }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.groupId.localeCompare(b.groupId));
}

/**
 * What a member may do unless an admin says otherwise: create projects and
 * invite people (v1 let any namespace member do both), and join open teams.
 */
export const MEMBER_DEFAULTS =
  ORG_CAPABILITIES.CREATE_APP | ORG_CAPABILITIES.INVITE_MEMBERS | ORG_CAPABILITIES.JOIN_OPEN_TEAMS;

export interface CreatedTeam {
  groupId: string;
  /** Set when the team exists but its member defaults could not be set (a cancelled passkey). */
  warning: string | null;
}

/** A new team: an org whose members may create projects and invite (a passkey step-up). */
export async function createTeam(
  client: Pick<CalimeroClient, "createOrg" | "setCapabilities">,
  name: string,
  passkey: () => PasskeyProvider,
): Promise<CreatedTeam> {
  const groupId = await client.createOrg(name);
  try {
    await client.setCapabilities(groupId, MEMBER_DEFAULTS, passkey());
    return { groupId, warning: null };
  } catch {
    return {
      groupId,
      warning: "The team was created, but people you invite will not be able to create projects or invite others yet.",
    };
  }
}

/** Whether a role may delete the team (its owner) rather than leave it. */
export const ownsTeam = (role: string | undefined) => role === "owner";
/** Whether a role manages members and deletes anyone's projects. */
export const isAdmin = (role: string | undefined) => role === "owner" || role === "admin";

/** The instances of this app (the dev bundle, or the package) in `org`, by name. */
export async function listProjects(
  client: Pick<CalimeroClient, "listApps">,
  source: AppSource,
  org: string,
): Promise<ProjectEntry[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps: AppInfo[] = await client.listApps(filter);
  return apps
    .filter((a) => a.org === org)
    .map((a) => ({ contextId: a.appId, name: a.name, owner: a.owner }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.contextId.localeCompare(b.contextId));
}

/** What a new document starts with: the contract's `init` arguments. */
export interface NewDocument {
  name: string;
  description: string;
  width: number;
  height: number;
}

/** A new project in `org`: one document. Answers the instance id. */
export function createProject(
  client: Pick<CalimeroClient, "createApp">,
  source: AppSource,
  org: string,
  doc: NewDocument,
): Promise<string> {
  return client.createApp(doc.name, source, { org, initArgs: doc });
}

// ── members ──────────────────────────────────────────────────────────────────

/** The parts of `GET /orgs/{org}` the screens read. */
export interface OrgMembers {
  name: string;
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> its display name in the org, where one is set. */
  names: Map<string, string>;
}

export async function readOrg(client: Pick<CalimeroClient, "getOrg">, org: string): Promise<OrgMembers> {
  const o = (await client.getOrg(org)) as unknown as Record<string, unknown>;
  const members = (o.members ?? {}) as Record<string, string>;
  const meta = (o.memberMetadata ?? {}) as Record<string, unknown>;
  const names = new Map<string, string>();
  for (const [account, value] of Object.entries(meta)) {
    const name = (value as { name?: unknown } | null)?.name;
    if (typeof name === "string" && name.trim()) names.set(account, name.trim());
  }
  return {
    name: typeof o.name === "string" ? o.name : "",
    roles: new Map(Object.entries(members)),
    names,
  };
}

/** Set the caller's own name in the team (org member metadata), shared by every app on it. */
export function setMyTeamName(
  client: Pick<CalimeroClient, "setMemberMetadata">,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  return client.setMemberMetadata(org, account, { name });
}

// ── invitations ──────────────────────────────────────────────────────────────

/** An invitation into `org` as a member, approved with the inviter's passkey (412 step-up). */
export function inviteToken(
  client: Pick<CalimeroClient, "invite">,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.invite(org, "member", passkey);
}

/** Where this frontend's routes start: the page's path up to `/teams`. */
export function appRoot(pathname: string = window.location.pathname): string {
  const at = pathname.indexOf("/teams");
  return at >= 0 ? pathname.slice(0, at) || "/" : "/";
}

/**
 * The link that opens this frontend with `token` to redeem. It also names
 * `org`: the token does not say which team it is for until it is redeemed, and
 * redeeming spends it, so the link carries the team for the app to tell an
 * existing member "you are already in" without spending a use.
 */
export function inviteLink(
  token: string,
  org?: string,
  location: Pick<Location, "origin" | "pathname"> = { origin: window.location.origin, pathname: appRoot() },
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
  if (org) url.searchParams.set("org", org);
  return url.toString();
}

const PENDING = `${APP}:pending-invite`;
const PENDING_ORG = `${APP}:pending-invite-org`;
const PENDING_ROUTE = `${APP}:pending-invite-route`;

/**
 * Takes `?invite=` (and the `?org=` beside it) off the address bar into
 * storage, before anything renders: a person opening a link is usually not
 * signed in yet, and the token must survive the sign-up. The route the link
 * opened is kept too, relative to the router's basename (`/{version}/` where a
 * node serves the app), so joining lands where the link pointed rather than
 * where the sign-in redirect left the visitor. Redeemed (and dropped) once a
 * session exists.
 */
export function captureInvite(
  storage: KeyValueStorage = localStorage,
  loc: Location = window.location,
  basename: string = nodeBasename(new URL(loc.href), "/"),
): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  const org = url.searchParams.get("org");
  const base = basename.endsWith("/") ? basename : `${basename}/`;
  const route = url.pathname.startsWith(base) ? `/${url.pathname.slice(base.length)}` : url.pathname;
  try {
    storage.setItem(PENDING, token);
    if (org) storage.setItem(PENDING_ORG, org);
    else storage.removeItem(PENDING_ORG);
    storage.setItem(PENDING_ROUTE, route);
  } catch {
    return;
  }
  url.searchParams.delete("invite");
  url.searchParams.delete("org");
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): string | null {
  try {
    return storage.getItem(PENDING);
  } catch {
    return null;
  }
}

/** The team the pending invitation's link named, when it named one. */
export function pendingInviteOrg(storage: KeyValueStorage = localStorage): string | null {
  try {
    return storage.getItem(PENDING_ORG);
  } catch {
    return null;
  }
}

/**
 * Where to go once the invitation is accepted: the route the link opened when
 * that is inside a team, else that team's projects (`org`, once the
 * redemption names it), else the teams list.
 */
export function pendingInviteRoute(org: string | null, storage: KeyValueStorage = localStorage): string {
  let route: string | null = null;
  try {
    route = storage.getItem(PENDING_ROUTE);
  } catch {
    /* nothing stored */
  }
  if (route && route.startsWith("/teams/")) return route;
  return org ? `/teams/${org}/projects` : "/teams";
}

export function dropInvite(storage: KeyValueStorage = localStorage): void {
  for (const key of [PENDING, PENDING_ORG, PENDING_ROUTE]) {
    try {
      storage.removeItem(key);
    } catch {
      /* nothing stored */
    }
  }
}

/**
 * Whether a redemption failed because the invitation itself is spent: used,
 * expired, revoked or unknown to the node. Those answer a 4xx; a 5xx or a
 * network failure is worth retrying with the same token.
 */
export function isSpentInvite(e: unknown): boolean {
  return e instanceof CalimeroError && e.status >= 400 && e.status < 500 && e.status !== 401;
}

/** What the invitation screen says about a spent invitation. */
export const SPENT_INVITE =
  "This invite was already used or has expired. Ask the person who invited you for a new link.";

/** The org an invitation redeemed into, from whichever field the node named it. */
export function joinedOrg(redeemed: Record<string, unknown>): string | null {
  for (const key of ["org", "orgId"]) {
    const v = redeemed[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}
