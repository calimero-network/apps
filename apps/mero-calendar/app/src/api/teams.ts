import { CalimeroError, ORG_CAPABILITIES, type AppInfo, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import { describeError, type AppSource, type KeyValueStorage } from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";

import { APP } from "./session";

/**
 * Teams, their calendars, members and invitations, on Calimero 1.0.
 *
 * | v1 | here |
 * |---|---|
 * | a team: a namespace of the app | an **organization** (`createOrg`) |
 * | a calendar: a context in the namespace (or a subgroup of it) | an **app instance** in the org (`createApp(name, source, { org })`) |
 * | the calendar's name: context metadata | the instance's `name` |
 * | the team's name: group metadata | the org's `name` |
 * | a namespace invitation (signed payload in a deflate+base58 link) | an **org invite** token in `?invite=` (`invite` is a passkey step-up; `redeemInvite` after sign-in) |
 * | `Admin` / `Member` + capability bits | org roles `owner`/`admin`/`member`/`guest` |
 * | join / leave a context, join sync | gone: an instance is on the cluster, nothing to join or sync |
 */

/** A team this account is in. */
export interface Team {
  /** The org id. Named for what the screens called it. */
  groupId: string;
  name: string;
  /** `owner` | `admin` | `member` | `guest`. */
  role: string;
}

/** A calendar: an instance of this app in a team's org. */
export interface CalendarEntry {
  /** The app instance id. */
  contextId: string;
  name: string;
  owner: string;
}

interface MeOrgs {
  orgs?: Array<{ orgId: string; name: string; role: string }>;
}

/**
 * Every org this account is in. Orgs are the platform's teams, not this app's
 * alone: a team made in another Calimero 1.0 app shows here too, and can hold
 * calendars.
 */
export async function listTeams(client: Pick<CalimeroClient, "me">): Promise<Team[]> {
  const me = (await client.me()) as MeOrgs;
  return (me.orgs ?? [])
    .map((o) => ({ groupId: o.orgId, name: o.name, role: o.role }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.groupId.localeCompare(b.groupId));
}

/**
 * What a member may do unless an admin says otherwise, as v1 set it on a new
 * team (`capabilities: 15`): create calendars and invite people (and join open
 * teams, the node's own default).
 */
export const MEMBER_DEFAULTS =
  ORG_CAPABILITIES.CREATE_APP | ORG_CAPABILITIES.INVITE_MEMBERS | ORG_CAPABILITIES.JOIN_OPEN_TEAMS;

export interface CreatedTeam {
  groupId: string;
  /** Set when the team exists but its member defaults could not be set (a cancelled passkey). */
  warning: string | null;
}

/** A new team: an org whose members may create calendars and invite (a passkey step-up). */
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
      warning: "The team was created, but people you invite will not be able to create calendars or invite others yet.",
    };
  }
}

/** Whether a role may delete the team (its owner) rather than leave it. */
export const ownsTeam = (role: string | undefined) => role === "owner";
/** Whether a role manages members and deletes calendars. */
export const isAdmin = (role: string | undefined) => role === "owner" || role === "admin";

/** The instances of this app (the dev bundle, or the package) in `org`, by name. */
export async function listCalendars(
  client: Pick<CalimeroClient, "listApps">,
  source: AppSource,
  org: string,
): Promise<CalendarEntry[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps: AppInfo[] = await client.listApps(filter);
  return apps
    .filter((a) => a.org === org)
    .map((a) => ({ contextId: a.appId, name: a.name, owner: a.owner }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.contextId.localeCompare(b.contextId));
}

/** A new calendar in `org`. Answers the instance id. */
export function createCalendar(
  client: Pick<CalimeroClient, "createApp">,
  source: AppSource,
  org: string,
  name: string,
): Promise<string> {
  return client.createApp(name, source, { org });
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
  const o = (await client.getOrg(org)) as Record<string, unknown>;
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

// ── invitations ──────────────────────────────────────────────────────────────

/** An invitation into `org` as a member, approved with the inviter's passkey (412 step-up). */
export function inviteToken(
  client: Pick<CalimeroClient, "invite">,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.invite(org, "member", passkey);
}

/**
 * The link that opens this frontend with `token` to redeem.
 *
 * `org` names the team the token joins. The token itself does not say, and
 * without it the app cannot tell an invitation into a team the visitor is
 * already in: redeeming that spends the link's single use on nobody.
 */
export function inviteLink(
  token: string,
  location: Pick<Location, "origin" | "pathname"> = window.location,
  org?: string | null,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
  if (org) url.searchParams.set("org", org);
  return url.toString();
}

const PENDING = `${APP}:pending-invite`;
const PENDING_ORG = `${APP}:pending-invite-org`;
const PENDING_ROUTE = `${APP}:pending-invite-route`;
const DEFERRED = `${APP}:invite-deferred`;

/** The landing page's own paths: a link to one of them names no destination. */
const FRONT_DOOR = new Set(["/", "/docs", "/preview", "/login"]);

/** `pathname` relative to the router basename, or null for the front door. */
export function routeOf(pathname: string, base: string = nodeBasename(new URL(window.location.href), "/")): string | null {
  const root = base.endsWith("/") ? base.slice(0, -1) : base;
  const rest = root && pathname.startsWith(root) ? pathname.slice(root.length) || "/" : pathname;
  const route = rest.startsWith("/") ? rest : `/${rest}`;
  return FRONT_DOOR.has(route.replace(/\/+$/, "") || "/") ? null : route;
}

/**
 * Takes `?invite=` off the address bar into storage, before anything renders: a
 * person opening a link is usually not signed in yet, and the token must
 * survive the sign-up. Redeemed (and dropped) once a session exists.
 */
export function captureInvite(storage: KeyValueStorage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  const org = url.searchParams.get("org");
  url.searchParams.delete("invite");
  url.searchParams.delete("org");
  const query = url.searchParams.toString();
  const route = routeOf(url.pathname);
  try {
    storage.setItem(PENDING, token);
    if (org) storage.setItem(PENDING_ORG, org);
    else storage.removeItem(PENDING_ORG);
    // A deep link (a team, a calendar) is where joining goes afterwards.
    if (route) storage.setItem(PENDING_ROUTE, `${route}${query ? `?${query}` : ""}`);
    else storage.removeItem(PENDING_ROUTE);
  } catch {
    return;
  }
  dropDeferral();
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): string | null {
  try {
    return storage.getItem(PENDING);
  } catch {
    return null;
  }
}

/** The team a pending invitation's link named (`&org=`), when it named one. */
export function pendingInviteOrg(storage: KeyValueStorage = localStorage): string | null {
  try {
    return storage.getItem(PENDING_ORG) || null;
  } catch {
    return null;
  }
}

/** The route a pending invitation's link was opened on, when it was not the front door. */
export function pendingInviteRoute(storage: KeyValueStorage = localStorage): string | null {
  try {
    const route = storage.getItem(PENDING_ROUTE);
    return route && route.startsWith("/") ? route : null;
  } catch {
    return null;
  }
}

export function dropInvite(storage: KeyValueStorage = localStorage): void {
  try {
    storage.removeItem(PENDING);
    storage.removeItem(PENDING_ORG);
    storage.removeItem(PENDING_ROUTE);
  } catch {
    /* nothing stored */
  }
  dropDeferral();
}

/**
 * "Not now" on the invitation page: the ordinary landing page for the rest of
 * this tab, with the token KEPT, so signing in later still joins.
 */
export function deferInvite(storage: Pick<Storage, "setItem"> = sessionStorage): void {
  try {
    storage.setItem(DEFERRED, "1");
  } catch {
    /* the page still moves on for this render */
  }
}

export function inviteDeferred(storage: Pick<Storage, "getItem"> = sessionStorage): boolean {
  try {
    return storage.getItem(DEFERRED) === "1";
  } catch {
    return false;
  }
}

function dropDeferral(storage: Pick<Storage, "removeItem"> = sessionStorage): void {
  try {
    storage.removeItem(DEFERRED);
  } catch {
    /* nothing stored */
  }
}

/** What to say when a token is refused for good. */
export const SPENT_INVITE = "This invite was already used or has expired. Ask the person who invited you for a new link.";

/**
 * Whether the node refused the token for good (unknown, used, expired,
 * revoked) rather than failing to answer.
 */
export function inviteRefused(e: unknown): boolean {
  // 401 (the session lapsed) and 429 (slow down) say nothing about the token.
  if (e instanceof CalimeroError) return e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;
  return /unknown invite|already used|expired|revoked|not found/i.test(describeError(e));
}

/** The plain sentence for a failed redemption. */
export function inviteFailure(e: unknown): string {
  return inviteRefused(e) ? SPENT_INVITE : `Could not join the team: ${describeError(e)}`;
}

/** The org an invitation redeemed into, from whichever field the node named it. */
export function joinedOrg(redeemed: Record<string, unknown>): string | null {
  for (const key of ["org", "orgId"]) {
    const v = redeemed[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}
