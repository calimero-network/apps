import { ORG_CAPABILITIES, type AppInfo, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import {
  createInviteStore,
  inviteLink as sharedInviteLink,
  type AppSource,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
} from "@calimero-apps/connect";
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
