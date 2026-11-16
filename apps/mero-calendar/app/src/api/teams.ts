import {
  ORG_CAPABILITIES,
  passkeyConfirm,
  type AppInfo,
  type CalimeroClient,
  type PasskeyProvider,
} from "@calimero-network/mero-js";
import {
  appPeople,
  appTarget,
  appTeamIdIn,
  finishAppOrg,
  createInviteStore,
  inviteLinkBase as sharedInviteLinkBase,
  isAppOnly,
  leaveApp,
  leaveOrg,
  listAppInfos,
  orgInstanceOptions,
  orgsWithApp,
  removeFromApp,
  removeFromAppTeam,
  sourcePackage,
  type AppOrgView,
  type AppSource,
  type ClientRoutes,
  type InviteStore,
  type KeyValueStorage,
  type LeftApp,
  type MaybeMe,
  type PendingInvite,
} from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";
import { setOrgName } from "@calimero-apps/names";

import { askOrgConsent, type TeamRoleName } from "./consent";
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
 *
 * The org gets this app's own **app team** (core#4890), through
 * `@calimero-apps/connect`'s org-app module: a new team's is open (everyone in
 * the org has the app), calendars use team access on it, invites name it, and
 * the member list is its people, and Remove and Leave take someone off it, out
 * of Mero Calendar, not out of the org (leaving offers the org too). Once an
 * admin keeps the org's apps apart in Calimero Home (`shared`), an invite
 * gives Mero Calendar only. An org without one (made before app teams, a node
 * without them, a raw dev bundle) is legacy, as before.
 *
 * The organization-wide changes (roles, removing from or leaving the org,
 * deleting it) go through the node's consent page on a session bound to the
 * app's frontend (`./consent`).
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
  client: ClientRoutes<{ auth: "me"; apps: "list"; orgs: "get" }>,
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

/**
 * What follows a team the node approved: its mark, member defaults (a passkey
 * step-up, skipped on a session bound to the app) and this app's own team, open.
 */
export async function finishTeam(
  client: ClientRoutes<{ orgs: "capabilities" | "get" | "metadata" | "appTeamsScope" }>,
  orgId: string,
  passkey: () => PasskeyProvider,
  source?: AppSource,
): Promise<CreatedTeam> {
  const made = await finishAppOrg(client, orgId, source, passkey, { capabilities: MEMBER_DEFAULTS });
  return {
    groupId: made.orgId,
    warning: made.capabilitiesError
      ? "The team was created, but people you invite will not be able to create calendars or invite others yet."
      : null,
  };
}

/** The app's name where an owner or admin is told who may add it, and in invite notes. */
export const PRODUCT_NAME = "Mero Calendar";

/** Where no passkey was handed over: asked for only to add Mero Calendar's team to an org. */
const noPasskey = (): PasskeyProvider => {
  throw new Error(`A passkey is needed to add ${PRODUCT_NAME} to this organization.`);
};

/** A client for the team's organization-wide changes: it says who it is and opens the consent page. */
type OrgClient = Pick<CalimeroClient, "session" | "openConsentPage"> & MaybeMe;

/** Mero Calendar's own team in `org` (the org read once), or `null`: a legacy org, a raw bundle. */
async function calendarTeamIn(
  client: ClientRoutes<{ orgs: "get" }>,
  org: string,
  source: AppSource | null,
): Promise<{ team: string; appOnly: boolean } | null> {
  const pkg = sourcePackage(source);
  if (!pkg) return null;
  const view = (await client.orgs.get({ org })) as AppOrgView;
  const team = appTeamIdIn(view, pkg);
  return team ? { team, appOnly: isAppOnly(view, pkg) } : null;
}

/**
 * Leaves the team. Where the org has Mero Calendar's own team, that is off
 * the team only, which this app may do itself (`lastApp` set when it was the
 * caller's last app there: offer {@link leaveTeamOrg}). An org without it (a
 * legacy one) is left altogether: on the node's consent page from the app's
 * frontend, else directly. Every step is a passkey step-up.
 */
export async function leaveTeam(
  client: OrgClient & ClientRoutes<{ orgs: "get" | "appTeamList" | "teamRemoveMember" | "removeMember" }>,
  org: string,
  source: AppSource | null,
  passkey: () => PasskeyProvider,
  self?: string,
): Promise<LeftApp> {
  const mine = await calendarTeamIn(client, org, source).catch(() => null);
  if (mine?.appOnly) return leaveApp(client, org, source, passkey, self ? { self } : {});
  if (mine) {
    const account = self ?? client.session?.accountId;
    if (!account) throw new Error("Sign in to leave.");
    await removeFromAppTeam(client, org, source, account, passkey);
    // The org's own app: offer leaving the organization too.
    return { left: "app", lastApp: true };
  }
  if (await askOrgConsent(client, { kind: "leaveOrg", org })) return { left: "org", lastApp: false };
  return leaveApp(client, org, source, passkey, self ? { self } : {});
}

/** Leaves the organization altogether, every app in it. A passkey step-up, on the consent page from the app's frontend. */
export async function leaveTeamOrg(
  client: OrgClient & ClientRoutes<{ orgs: "removeMember" }>,
  org: string,
  passkey: () => PasskeyProvider,
  self?: string,
): Promise<void> {
  if (await askOrgConsent(client, { kind: "leaveOrg", org })) return;
  return leaveOrg(client, org, passkey, self);
}

/**
 * Removes `account` from the team. Where the org has Mero Calendar's own team,
 * off that team only: they stay in the organization and its other apps. An
 * org without it (a legacy one) removes them from the organization: on the
 * node's consent page from the app's frontend, else directly. `name` is what
 * the screens call them.
 */
export async function removeTeamMember(
  client: OrgClient & ClientRoutes<{ orgs: "get" | "teamRemoveMember" | "removeMember" }>,
  org: string,
  source: AppSource | null,
  account: string,
  passkey: () => PasskeyProvider,
  name: string = account,
): Promise<"app" | "org"> {
  if (await calendarTeamIn(client, org, source).catch(() => null)) {
    await removeFromAppTeam(client, org, source, account, passkey);
    return "app";
  }
  if (await askOrgConsent(client, { kind: "removeMember", org, account, name })) return "org";
  return removeFromApp(client, org, source, account, passkey);
}

/** Gives `account` the team role `role`: an organization role, on the consent page from the app's frontend. */
export async function setTeamRole(
  client: OrgClient & ClientRoutes<{ orgs: "setMember" }>,
  org: string,
  account: string,
  role: TeamRoleName,
  passkey: () => PasskeyProvider,
  name: string = account,
): Promise<void> {
  if (await askOrgConsent(client, { kind: "setMemberRole", org, account, role, name })) return;
  await client.orgs.setMember({ org, account, role }, { confirm: passkeyConfirm(passkey()) });
}

/** The team's owner deletes it, with its calendars: on the consent page from the app's frontend. */
export async function deleteTeam(
  client: OrgClient & ClientRoutes<{ orgs: "delete" }>,
  org: string,
  passkey: () => PasskeyProvider,
): Promise<void> {
  if (await askOrgConsent(client, { kind: "deleteOrg", org })) return;
  await client.orgs.delete({ org }, { confirm: passkeyConfirm(passkey()) });
}

/** Whether a role may delete the team (its owner) rather than leave it. */
export const ownsTeam = (role: string | undefined) => role === "owner";
/** Whether a role manages members and deletes calendars. */
export const isAdmin = (role: string | undefined) => role === "owner" || role === "admin";

/** The instances of this app (the dev bundle, or the package) in `org`, by name. */
export async function listCalendars(
  client: ClientRoutes<{ apps: "list" }>,
  source: AppSource,
  org: string,
): Promise<CalendarEntry[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps: AppInfo[] = await listAppInfos(client, filter);
  return apps
    .filter((a) => a.org === org)
    .map((a) => ({ contextId: a.appId, name: a.name, owner: a.owner }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.contextId.localeCompare(b.contextId));
}

/** The calendar created in an org the account connects to this app ("Connect to an existing organization"). */
export const CONNECTED_CALENDAR_NAME = "Calendar";

/**
 * A new calendar in `org`, on this app's team (`orgInstanceOptions`: made
 * first, by an owner or admin, in an org whose other apps have teams;
 * organization access in a legacy org). Answers the instance id.
 */
export async function createCalendar(
  client: Pick<CalimeroClient, "session"> & ClientRoutes<{ apps: "create"; orgs: "get" | "appTeamsScope" }>,
  source: AppSource,
  org: string,
  name: string,
  passkey: () => PasskeyProvider = noPasskey,
): Promise<string> {
  return client.apps
    .create({ name, ...appTarget(source), ...(await orgInstanceOptions(client, org, source, passkey, PRODUCT_NAME)) })
    .then((r) => r.appId);
}

// ── members ──────────────────────────────────────────────────────────────────

/** The parts of `GET /orgs/{org}` the screens read. */
export interface OrgMembers {
  name: string;
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> its display name in the org, where one is set. */
  names: Map<string, string>;
  /** Who has Mero Calendar in the org, in org order: its app team, else the org (no guest once it has app teams). */
  people: string[];
  /** The org keeps its apps apart and Mero Calendar has its team: invites, Remove and Leave are its only. */
  appOnly: boolean;
}

export async function readOrg(
  client: ClientRoutes<{ orgs: "get" }>,
  org: string,
  source: AppSource | null = null,
): Promise<OrgMembers> {
  const o = (await client.orgs.get({ org })) as Record<string, unknown>;
  const pkg = sourcePackage(source);
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
    people: appPeople(o as AppOrgView, pkg),
    appOnly: isAppOnly(o as AppOrgView, pkg),
  };
}

/**
 * Your name in `org`: asked when you create or join the team, and used by
 * every calendar in it. Kept in the org's member metadata `{ name }`.
 */
export function setMyTeamName(
  client: ClientRoutes<{ orgs: "get" | "memberMetadata" }>,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  return setOrgName(client, org, account, name);
}

// ── invitations ──────────────────────────────────────────────────────────────

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
 * The page an invitation link opens (the shared invite dialog adds the token),
 * and the page it was made on (a team, a calendar), which joining opens.
 *
 * `org` names the team the token joins. The token itself does not say, and
 * without it the app cannot tell an invitation into a team the visitor is
 * already in: redeeming that spends the link's single use on nobody.
 *
 * The link stays under the served `/{version}/` root until every cluster's
 * served-host redirect keeps the query string (core's served-redirect fix).
 */
export function inviteLinkBase(org: string, location: Pick<Location, "href"> = window.location): string {
  const url = new URL(location.href);
  const root = nodeBasename(url, "/");
  return sharedInviteLinkBase({ org, route: routeOf(url.pathname, root), root, origin: url.origin });
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
