import { ORG_CAPABILITIES, type AppInfo, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import {
  markOrgFor,
  orgsWithApp,
  SPENT_INVITE_COPY,
  createInviteStore,
  describeRedeemFailure,
  inviteLink as sharedInviteLink,
  isSpentInvite,
  type AppSource,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
} from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";
import { setOrgName } from "@calimero-apps/names";

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


/**
 * The teams: the orgs this account is in that hold calendars or were made for
 * this app. An org made for another app (a Mero Blocks world) is not listed:
 * it is offered under "Connect to an existing organization" ({@link
 * otherOrgs} in `@calimero-apps/connect`) and joins the list once it holds
 * one.
 */
export async function listTeams(
  client: Pick<CalimeroClient, "me" | "listApps" | "getOrg">,
  source: AppSource,
): Promise<Team[]> {
  return (await orgsWithApp(client, source, { marked: true }))
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
  client: Pick<CalimeroClient, "createOrg" | "setCapabilities" | "getOrg" | "setOrgMetadata">,
  name: string,
  passkey: () => PasskeyProvider,
  source?: AppSource,
): Promise<CreatedTeam> {
  const groupId = await client.createOrg(name);
  // Listed as a team before it holds calendars.
  if (source) await markOrgFor(client, groupId, source);
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

/** The calendar created in an org the account connects to this app ("Connect to an existing organization"). */
export const CONNECTED_CALENDAR_NAME = "Calendar";

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

/**
 * Your name in `org`: asked when you create or join the team, and used by
 * every calendar in it. Kept in the org's member metadata `{ name }`.
 */
export function setMyTeamName(
  client: Pick<CalimeroClient, "getOrg" | "setMemberMetadata">,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  return setOrgName(client, org, account, name);
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
 * The link that opens this frontend with `token` to redeem, and the page it
 * was made on (a team, a calendar), which joining opens.
 *
 * `org` names the team the token joins. The token itself does not say, and
 * without it the app cannot tell an invitation into a team the visitor is
 * already in: redeeming that spends the link's single use on nobody.
 *
 * The link stays under the served `/{version}/` root until every cluster's
 * served-host redirect keeps the query string (core's served-redirect fix).
 */
export function inviteLink(
  token: string,
  location: Pick<Location, "href"> = window.location,
  org?: string | null,
): string {
  const url = new URL(location.href);
  const root = nodeBasename(url, "/");
  return sharedInviteLink(token, { org, route: routeOf(url.pathname, root), root, origin: url.origin });
}

/** This app's pending invite (`@calimero-apps/connect`), captured in `index.tsx` before React mounts. */
export const invites = createInviteStore(APP);

const LEGACY_PENDING = `${APP}:pending-invite`;
const LEGACY_ORG = `${APP}:pending-invite-org`;
const LEGACY_ROUTE = `${APP}:pending-invite-route`;
const DEFERRED = `${APP}:invite-deferred`;

/**
 * Takes `?invite=` (and the team and route it names) off the address bar into
 * the store, before anything renders: a person opening a link is usually not
 * signed in yet, and the token must survive the sign-up. An invite an earlier
 * build stored under its own keys moves over first; a new link undoes "Not now".
 */
export function captureInvite(loc: Pick<Location, "href"> = window.location): void {
  migrateLegacyInvite();
  if (invites.capture(loc, { basename: nodeBasename(new URL(loc.href), "/") })) dropDeferral();
}

/** Moves an invite an earlier build stored under its own keys into the shared store. */
export function migrateLegacyInvite(storage: KeyValueStorage = localStorage, into: InviteStore = invites): void {
  try {
    const token = storage.getItem(LEGACY_PENDING);
    if (token) {
      const route = storage.getItem(LEGACY_ROUTE);
      into.put({
        token,
        org: storage.getItem(LEGACY_ORG) || null,
        team: null,
        doc: null,
        // The old record kept the route's own query; the store keeps the path.
        route: route ? route.split("?")[0] : null,
        extra: {},
      });
    }
    for (const key of [LEGACY_PENDING, LEGACY_ORG, LEGACY_ROUTE]) storage.removeItem(key);
  } catch {
    /* storage unavailable: nothing was stored */
  }
}

/** The pending invite's token, when there is one. */
export function pendingInvite(): string | null {
  return invites.token();
}

/** The team a pending invitation's link named (`&org=`), when it named one. */
export function pendingInviteOrg(): string | null {
  return invites.pending()?.org ?? null;
}

/** The route a pending invitation's link was opened on, when it was not the front door. */
export function inviteRoute(invite: Pick<PendingInvite, "route"> | null): string | null {
  const route = invite?.route ?? null;
  return route && routeOf(route, "/") ? route : null;
}

/** The route the pending invitation's link was opened on, when it was not the front door. */
export function pendingInviteRoute(): string | null {
  return inviteRoute(invites.pending());
}

export function dropInvite(): void {
  invites.drop();
  dropDeferral();
}

/**
 * Set when a sign-up joined with the page's invite, before the session is
 * signed in: where its link pointed. `InvitationPrompt` (inside the router,
 * which the session is not) takes it once signed in and opens it; until then
 * the front door does not redirect on its own.
 */
let joinedAtSignUp: { org: string | null; route: string | null } | null = null;

/** `onJoinedAtSignUp` for `usePasskeySession`: remember what to open. */
export function noteJoinedAtSignUp({ org }: { org: string | null }, pending: PendingInvite | null): void {
  joinedAtSignUp = { org: org ?? pending?.org ?? null, route: inviteRoute(pending) };
}

/** Whether a sign-up just joined with the invite and what it named is still to open. */
export function joinedAtSignUpPending(): boolean {
  return joinedAtSignUp !== null;
}

/** Where a sign-up that just joined with the invite goes, once; `null` when none did. */
export function takeJoinedAtSignUp(): string | null {
  const joined = joinedAtSignUp;
  joinedAtSignUp = null;
  if (!joined) return null;
  return joined.route ?? (joined.org ? `/teams/${joined.org}` : "/teams");
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
export const SPENT_INVITE = SPENT_INVITE_COPY;

/**
 * Whether the node refused the token for good (unknown, used, expired,
 * revoked) rather than failing to answer: a lapsed session (401), a rate
 * limit (429) or the cluster unreachable keeps it.
 */
export function inviteRefused(e: unknown): boolean {
  return isSpentInvite(e);
}

/** The plain sentence for a failed redemption. */
export function inviteFailure(e: unknown): string {
  return describeRedeemFailure(e);
}

/** The org an invitation redeemed into, from whichever field the node named it. */
export function joinedOrg(redeemed: Record<string, unknown>): string | null {
  for (const key of ["org", "orgId"]) {
    const v = redeemed[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}
