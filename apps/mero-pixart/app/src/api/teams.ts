import { ORG_CAPABILITIES, type AppInfo, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import {
  appInvite,
  appPeople,
  createAppOrg,
  isAppOnly,
  leaveApp,
  leaveOrg,
  orgInstanceOptions,
  orgsWithApp,
  removeFromApp,
  sourcePackage,
  type AppInviteToken,
  type AppOrgView,
  type LeftApp,
  createInviteStore,
  inviteLink as sharedInviteLink,
  type AppSource,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
} from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";
import { setOrgName } from "@calimero-apps/names";

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
 *
 * The org gets this app's own **app team** (core#4890), through
 * `@calimero-apps/connect`'s org-app module: a new team's is open (everyone in
 * the org has the app), projects use team access on it, invites name it, and
 * the member list is its people. Once an admin keeps the org's apps apart in
 * Calimero Home (`shared`), an invite gives Mero Pixart only, and Remove and
 * Leave take someone out of Mero Pixart, not out of the org (leaving the last
 * app offers the org too). An org without one (made before app teams, a node
 * without them, a raw dev bundle) is legacy, as before.
 */

/** The app's name where an owner or admin is told who may add it, and in invite notes. */
export const PRODUCT_NAME = "Mero Pixart";

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


/**
 * The teams: the orgs this account is in that hold projects or were made for
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
  client: Pick<CalimeroClient, "createOrg" | "setCapabilities" | "getOrg" | "setOrgMetadata" | "scopeApps">,
  name: string,
  passkey: () => PasskeyProvider,
  source?: AppSource,
): Promise<CreatedTeam> {
  // The org, marked so it is listed as a team before it holds projects, its
  // member defaults, and this app's own team, open (declined, or an older
  // node: a legacy org).
  const made = await createAppOrg(client, name, source, passkey, { capabilities: MEMBER_DEFAULTS });
  return {
    groupId: made.orgId,
    warning: made.capabilitiesError
      ? "The team was created, but people you invite will not be able to create projects or invite others yet."
      : null,
  };
}

/**
 * Leaves the team (`leaveApp`, a passkey step-up). In an org that keeps its
 * apps apart that is Mero Pixart only, with `lastApp` set when it was the
 * caller's last app there (offer {@link leaveTeamOrg}); elsewhere the org.
 */
export function leaveTeam(
  client: Pick<CalimeroClient, "getOrg" | "listAppTeams" | "removeTeamMember" | "removeMember" | "session">,
  org: string,
  source: AppSource | null,
  passkey: () => PasskeyProvider,
  self?: string,
): Promise<LeftApp> {
  return leaveApp(client, org, source, passkey, self ? { self } : {});
}

/** Leaves the organization altogether, every app in it. A passkey step-up. */
export function leaveTeamOrg(
  client: Pick<CalimeroClient, "removeMember" | "session">,
  org: string,
  passkey: () => PasskeyProvider,
  self?: string,
): Promise<void> {
  return leaveOrg(client, org, passkey, self);
}

/**
 * Removes `account` from the team (`removeFromApp`, a passkey step-up): in an
 * org that keeps its apps apart, out of Mero Pixart only, never out of the
 * org; elsewhere out of the org, as before.
 */
export function removeTeamMember(
  client: Pick<CalimeroClient, "getOrg" | "removeTeamMember" | "removeMember">,
  org: string,
  source: AppSource | null,
  account: string,
  passkey: () => PasskeyProvider,
): Promise<"app" | "org"> {
  return removeFromApp(client, org, source, account, passkey);
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

/** The project created in an org the account connects to this app ("Connect to an existing organization"). */
export const CONNECTED_PROJECT: NewDocument = { name: "Untitled", description: "", width: 1280, height: 720 };

/**
 * A new project in `org`: one document, on this app's team
 * (`orgInstanceOptions`: made first, by an owner or admin, in an org whose
 * other apps have teams; organization access in a legacy org). Answers the
 * instance id.
 */
export async function createProject(
  client: Pick<CalimeroClient, "createApp" | "getOrg" | "scopeApps" | "session">,
  source: AppSource,
  org: string,
  doc: NewDocument,
  passkey: () => PasskeyProvider,
): Promise<string> {
  const options = await orgInstanceOptions(client, org, source, passkey, PRODUCT_NAME);
  return client.createApp(doc.name, source, { ...options, initArgs: doc });
}

// ── members ──────────────────────────────────────────────────────────────────

/** The parts of `GET /orgs/{org}` the screens read. */
export interface OrgMembers {
  name: string;
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> its display name in the org, where one is set. */
  names: Map<string, string>;
  /** Who has Mero Pixart in the org, in org order: its app team, else the org (no guest once it has app teams). */
  people: string[];
  /** The org keeps its apps apart and this one has its team: invites, Remove and Leave are Mero Pixart's only. */
  appOnly: boolean;
}

export async function readOrg(
  client: Pick<CalimeroClient, "getOrg">,
  org: string,
  source: AppSource | null = null,
): Promise<OrgMembers> {
  const o = (await client.getOrg(org)) as unknown as Record<string, unknown>;
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
 * Set the caller's own name in the team (org member metadata), shared by every
 * app on it. Keeps the rest of the member record, and remembers the name to
 * offer when the next team asks.
 */
export function setMyTeamName(
  client: Pick<CalimeroClient, "setMemberMetadata" | "getOrg">,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  return setOrgName(client, org, account, name);
}

// ── invitations ──────────────────────────────────────────────────────────────

/**
 * An invitation into `org` as a member, approved with the inviter's passkey
 * (412 step-up), naming this app's team (`appInvite`): `appOnly` when it gives
 * Mero Pixart only (an org that keeps its apps apart). Org-wide in a legacy org.
 */
export function inviteToken(
  client: Pick<CalimeroClient, "listAppTeams" | "invite">,
  org: string,
  passkey: PasskeyProvider,
  source: AppSource | null = null,
): Promise<AppInviteToken> {
  return appInvite(client, org, source, passkey);
}

/**
 * The link that opens this frontend with `token` to redeem. It also names
 * `org`: the token does not say which team it is for until it is redeemed, and
 * redeeming spends it, so the link carries the team for the app to tell an
 * existing member "you are already in" without spending a use.
 *
 * The link stays under the served `/{version}/` root until every cluster's
 * served-host redirect keeps the query string (core's served-redirect fix).
 */
export function inviteLink(token: string, org?: string, location: Pick<Location, "href"> = window.location): string {
  const url = new URL(location.href);
  return sharedInviteLink(token, { org, root: nodeBasename(url, "/"), origin: url.origin });
}

/** This app's pending invite (`@calimero-apps/connect`), captured in `main.tsx` before React mounts. */
export const invites = createInviteStore(APP);

const LEGACY_PENDING = `${APP}:pending-invite`;
const LEGACY_ORG = `${APP}:pending-invite-org`;
const LEGACY_ROUTE = `${APP}:pending-invite-route`;

/**
 * Moves an invite an earlier build stored under its own keys into the shared
 * store, so a link opened before the upgrade still joins after it.
 */
export function migrateLegacyInvite(storage: KeyValueStorage = localStorage, store: InviteStore = invites): void {
  try {
    const token = storage.getItem(LEGACY_PENDING);
    if (token) {
      store.put({
        token,
        org: storage.getItem(LEGACY_ORG),
        team: null,
        doc: null,
        route: storage.getItem(LEGACY_ROUTE),
        extra: {},
      });
    }
    for (const key of [LEGACY_PENDING, LEGACY_ORG, LEGACY_ROUTE]) storage.removeItem(key);
  } catch {
    /* storage unavailable: nothing was stored */
  }
}

/**
 * Where to go once the invitation is accepted: the route the link opened when
 * that is inside a team, else that team's projects (`org`, once the
 * redemption names it), else the teams list.
 */
export function inviteRoute(invite: Pick<PendingInvite, "route"> | null, org: string | null): string {
  const route = invite?.route ?? null;
  if (route && route.startsWith("/teams/")) return route;
  return org ? `/teams/${org}/projects` : "/teams";
}

/** What a sign-up that joined with the page's invite joined, and where its link pointed. */
export interface JoinedAtSignUp {
  org: string | null;
  invite: PendingInvite | null;
}

/**
 * Set when a sign-up joined with the page's invite, before the session is
 * signed in; `InvitationHost` (inside the router, which the session is not)
 * takes it once signed in and opens what the link pointed at.
 */
let joinedAtSignUp: JoinedAtSignUp | null = null;

/** `onJoinedAtSignUp` for `usePasskeySession`: remember what to open. */
export function noteJoinedAtSignUp({ org }: { org: string | null }, pending: PendingInvite | null): void {
  joinedAtSignUp = { org: org ?? pending?.org ?? null, invite: pending };
}

/** What a sign-up just joined with the invite, once; `null` when none did. */
export function takeJoinedAtSignUp(): JoinedAtSignUp | null {
  const joined = joinedAtSignUp;
  joinedAtSignUp = null;
  return joined;
}
