/**
 * App teams: one organization, many apps, separate access.
 *
 * Each app installed in an organization gets its own **app team** (core: a
 * top-level team whose `metadata.app.package` names the package; one per
 * package per org), and its instances use `{ kind: "team" }` access on it. An
 * in-app invite names the app team, so it lets the person into this app and
 * no other. The organization's mode is derived by the node, never stored:
 *
 * - `legacy`: no app team; the org's apps use organization access (everyone in
 *   the org reaches them), as every org did before app teams.
 * - `standalone`: every app team is open (`join: "everyone"`): the org belongs
 *   to one app and everyone in it has that app. Members may invite (the team's
 *   default capabilities hold `INVITE_MEMBERS`).
 * - `shared`: the app teams are closed (`join: "invite"`): each app lists who is
 *   in it, and only leads and admins invite unless an admin turns on "members
 *   may invite" for that app.
 *
 * Core's routes (`GET`/`POST /orgs/{org}/app-teams`) are new (core#4890). On a
 * node without them every helper here falls back to what the org routes alone
 * tell: no app team, an org-wide invite, the org role.
 */
import {
  CalimeroError,
  DEFAULT_ORG_CAPABILITIES,
  ORG_CAPABILITIES,
  passkeyConfirm,
  type AppTeam,
  type AppTeams,
  type CalimeroClient,
  type OrgMode,
  type PasskeyProvider,
  type ScopeAppsResult,
  type ScopedAppTeam,
} from "@calimero-network/mero-js";

import type { OrgAccessView } from "./invite";
import type { ClientRoutes } from "./routes";

/** Whether `error` is the node's 404: no such route (an older node), or not a member of the org. */
export function isNotFound(error: unknown): boolean {
  if (error instanceof CalimeroError) return error.status === 404;
  const status = (error as { status?: unknown } | null)?.status;
  return status === 404;
}

/**
 * The org's mode and app teams (`listAppTeams`), or `null` when the node
 * cannot say: a node without the route (before core#4890) or an account
 * outside the org, both a 404. Any other failure is thrown.
 */
export async function appTeams(client: ClientRoutes<{ orgs: "appTeamList" }>, org: string): Promise<AppTeams | null> {
  try {
    const answer = await client.orgs.appTeamList({ org });
    return { mode: answer.mode, appTeams: Array.isArray(answer.appTeams) ? answer.appTeams : [] };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** One package's app team in an org, with the org's mode ({@link appTeamOf}). */
export interface AppTeamOf {
  mode: OrgMode;
  /** `null` when the org has no app team for the package (legacy, or not installed here). */
  team: AppTeam | null;
}

/**
 * `pkg`'s app team in `org` and the org's mode; `null` when the node cannot
 * say (see {@link appTeams}). A guest sees only the app teams they are in, so
 * for a guest `team: null` can also mean "not yours".
 */
export async function appTeamOf(
  client: ClientRoutes<{ orgs: "appTeamList" }>,
  org: string,
  pkg: string,
): Promise<AppTeamOf | null> {
  const answer = await appTeams(client, org);
  if (!answer) return null;
  return { mode: answer.mode, team: answer.appTeams.find((t) => t.package === pkg) ?? null };
}

export interface CreateAppTeamOptions {
  /** The team's name, 1..64 characters (absent: the package's display name, else the package id). */
  name?: string;
  /**
   * The instances to move onto the team. Absent: every organization-access
   * instance of the package in the org (everyone who reaches them now keeps
   * them). `[]`: none, for a fresh install.
   */
  instances?: string[];
  /** Close every app team in the org (absent: the node decides: when it then holds two or more). */
  shared?: boolean;
}

/**
 * Give `pkg` its app team in `org` (core `ScopeApps`, one atomic log entry):
 * find or make the team (the caller leads a new one), add a row for everyone
 * who reaches the package's instances now, and move those instances onto it.
 * Owner or admin only, approved with `passkey`. Idempotent: a package that has
 * a team already answers it with `created: false`.
 */
export async function createAppTeam(
  client: ClientRoutes<{ orgs: "appTeamsScope" }>,
  org: string,
  pkg: string,
  passkey: PasskeyProvider,
  options: CreateAppTeamOptions = {},
): Promise<ScopedAppTeam & { mode: OrgMode }> {
  const app: { package: string; name?: string; instances?: string[] } = { package: pkg };
  if (options.name) app.name = options.name;
  if (options.instances) app.instances = options.instances;
  // The document answers each team's `join` as nullable, mero-js's
  // `ScopedAppTeam` as optional: the same answer, typed two ways.
  const result = (await client.orgs.appTeamsScope(
    { org, apps: [app], ...(options.shared === undefined ? {} : { shared: options.shared }) },
    { confirm: passkeyConfirm(passkey) },
  )) as unknown as ScopeAppsResult;
  const team = result.teams.find((t) => t.package === pkg) ?? result.teams[0];
  if (!team) throw new Error(`the node made no app team for ${pkg}`);
  return { ...team, mode: result.mode };
}

/**
 * `pkg`'s app team in `org`, made now when it has none ({@link createAppTeam};
 * owner or admin). Reads first, so a member opening an app that has its team
 * already is never asked for a passkey. `null` on a node without app teams.
 */
export async function ensureAppTeam(
  client: ClientRoutes<{ orgs: "appTeamList" | "appTeamsScope" }>,
  org: string,
  pkg: string,
  passkey: PasskeyProvider,
  options: CreateAppTeamOptions = {},
): Promise<{ teamId: string; created: boolean; mode: OrgMode } | null> {
  const found = await appTeamOf(client, org, pkg);
  if (!found) return null;
  if (found.team) return { teamId: found.team.teamId, created: false, mode: found.mode };
  const made = await createAppTeam(client, org, pkg, passkey, options);
  return { teamId: made.teamId, created: made.created, mode: made.mode };
}

export interface InviteToAppOptions {
  /** The invite's org role (default `member`). A guest is app-only: they reach only the apps named. */
  role?: "guest" | "member" | "admin";
  passkey: PasskeyProvider;
  /** More teams to add the person to (a private channel's child team). */
  teams?: string[];
  ttlSecs?: number;
  uses?: number;
}

/** What {@link inviteToApp} made. */
export interface AppInvite {
  token: string;
  /** The app teams the invite names; `[]` when it is an org-wide invite (legacy org, older node). */
  teams: string[];
  mode: OrgMode | null;
}

/** Thrown by {@link inviteToApp} when a package named has no app team in a shared org. */
export class NoAppTeamError extends Error {
  readonly package: string;
  constructor(pkg: string) {
    super(`This organization has not set up ${pkg} yet: ask an admin to add it in Calimero Home.`);
    this.name = "NoAppTeamError";
    this.package = pkg;
  }
}

/**
 * An invite into `org` naming `pkg`'s app team (or several packages' teams),
 * approved with the inviter's passkey: the person gets those apps and no
 * other. The same call in both modes: in a standalone org the team is open, so
 * it is an org invite that lands in the app.
 *
 * Falls back to an org-wide invite (today's behaviour) where the org has no
 * app teams at all (`legacy`) or the node has no app-team route. In an org
 * that has app teams, a package without one is refused ({@link NoAppTeamError})
 * rather than widened to the whole org.
 */
export async function inviteToApp(
  client: ClientRoutes<{ orgs: "appTeamList" | "inviteCreate" }>,
  org: string,
  pkg: string | readonly string[],
  options: InviteToAppOptions,
): Promise<AppInvite> {
  const pkgs = typeof pkg === "string" ? [pkg] : [...pkg];
  const answer = await appTeams(client, org);
  const named: string[] = [];
  if (answer && answer.appTeams.length > 0) {
    for (const p of pkgs) {
      const team = answer.appTeams.find((t) => t.package === p);
      if (!team) throw new NoAppTeamError(p);
      named.push(team.teamId);
    }
  }
  const teams = [...new Set([...named, ...(options.teams ?? [])])];
  const extra: { ttlSecs?: number; uses?: number } = {};
  if (options.ttlSecs !== undefined) extra.ttlSecs = options.ttlSecs;
  if (options.uses !== undefined) extra.uses = options.uses;
  const { token } = await client.orgs.inviteCreate(
    { org, role: options.role ?? "member", teams, ...extra },
    { confirm: passkeyConfirm(options.passkey) },
  );
  return { token, teams: named, mode: answer?.mode ?? null };
}

/** What the signed-in account may do with one app in one org ({@link appAccess}). */
export interface AppAccess {
  /** The org's mode; `null` on a node without app teams. */
  mode: OrgMode | null;
  /** The app's team; `null` when there is none (legacy, not installed, a guest outside it, an older node). */
  team: AppTeam | null;
  /** The account's org role (`owner`, `admin`, `member`, `guest`), `null` when it is not in the org. */
  role: string | null;
  /** Whether the account has the app here: in its team, or, without one, in the org (not as a guest of a moded org). */
  member: boolean;
  /** Whether it manages the app's people: an owner or admin, or a lead of its team. */
  manages: boolean;
  /**
   * Whether it may invite people to this app: a manager; else someone in the
   * app whose own row on the team, or the org's caps with the team's default,
   * hold `INVITE_MEMBERS` (decision 1: on in standalone, off in shared until
   * an admin turns on "members may invite" for that app). Without a team: an
   * admin, or a member holding `INVITE_MEMBERS` org-wide.
   */
  mayInvite: boolean;
}

const ADMIN = new Set(["owner", "admin"]);
const INVITE = ORG_CAPABILITIES.INVITE_MEMBERS;

/** The org-level part of the access rule: role and own caps, from `getOrg`. */
function orgSide(org: OrgAccessView, account: string) {
  const role = org.members?.[account] ?? null;
  const orgCaps = org.capabilities?.[account] ?? org.defaultCapabilities ?? DEFAULT_ORG_CAPABILITIES;
  return { role, orgCaps };
}

/**
 * The signed-in account's access to `pkg` in `org`: the mode, its team, and
 * whether it is in the app, manages it and may invite to it. Reads
 * `listAppTeams` and `getOrg` (for the role and capability rows), so it is
 * what an app's member menu and invite button decide on.
 */
export async function appAccess(
  client: Pick<CalimeroClient, "session"> & ClientRoutes<{ orgs: "appTeamList" | "get" }>,
  org: string,
  pkg: string,
): Promise<AppAccess> {
  const account = client.session?.accountId ?? null;
  const [found, view] = await Promise.all([
    appTeamOf(client, org, pkg),
    client.orgs.get({ org }).then(
      (o) => o as OrgAccessView,
      () => null,
    ),
  ]);
  const side = view && account ? orgSide(view, account) : { role: null, orgCaps: DEFAULT_ORG_CAPABILITIES };
  const admin = side.role !== null && ADMIN.has(side.role);
  const mode = found?.mode ?? null;
  const team = found?.team ?? null;

  if (!team) {
    // No app team: the org's own access decides (legacy, or an older node). A
    // guest of an org that has app teams reaches no organization-access app.
    const inOrg = side.role !== null && !(side.role === "guest" && mode !== null && mode !== "legacy");
    return {
      mode,
      team,
      role: side.role,
      member: inOrg,
      manages: admin,
      mayInvite: admin || (inOrg && side.role !== "guest" && (side.orgCaps & INVITE) !== 0),
    };
  }

  const manages = admin || team.manages;
  const rowCaps = account ? view?.teams?.[team.teamId]?.capabilities?.[account] : undefined;
  const caps = rowCaps ?? side.orgCaps | (team.defaultCapabilities ?? 0);
  return {
    mode,
    team,
    role: side.role,
    member: team.member,
    manages,
    mayInvite: manages || (team.member && (caps & INVITE) !== 0),
  };
}

const JOIN_OPEN = ORG_CAPABILITIES.JOIN_OPEN_TEAMS;

/**
 * Who is in top-level team `teamId` (an app team), from `getOrg` as the
 * caller reads it, as core decides it (`Org::in_team`): a direct row; and,
 * for an open team, every org member not taken out of it who holds
 * `JOIN_OPEN_TEAMS` (owners and admins hold every capability), except a guest
 * once the org has app teams (any `mode` but `legacy`). In org order. `[]`
 * for a team the caller does not see. Core leaves out of `getOrg` the people
 * the caller may not see, so in a shared org a member gets the people of
 * their own apps.
 */
export function appTeamMembers(
  org: OrgAccessView,
  teamId: string,
  mode: OrgMode | null = null,
): string[] {
  const team = org.teams?.[teamId];
  if (!team) return [];
  const members = org.members ?? {};
  // A row counts only while its account is in the org (core removes both together).
  const out = new Set(Object.keys(team.members ?? {}).filter((a) => a in members));
  if (team.join === "everyone") {
    const removed = new Set(team.removed ?? []);
    for (const [account, role] of Object.entries(members)) {
      if (out.has(account) || removed.has(account)) continue;
      if (role === "guest" && mode !== "legacy") continue;
      const caps = ADMIN.has(role)
        ? ~0
        : (org.capabilities?.[account] ?? org.defaultCapabilities ?? DEFAULT_ORG_CAPABILITIES);
      if ((caps & JOIN_OPEN) !== 0) out.add(account);
    }
  }
  return Object.keys(members).filter((a) => out.has(a));
}

/** Whether `team`'s members may invite others to its app (the team default holds `INVITE_MEMBERS`). */
export function membersMayInvite(team: Pick<AppTeam, "defaultCapabilities">): boolean {
  return ((team.defaultCapabilities ?? 0) & INVITE) !== 0;
}

/**
 * Turn "members may invite to this app" on or off: the team's default
 * capabilities with `INVITE_MEMBERS` set or cleared, every other bit kept.
 * The team's managers (or `MANAGE_MEMBERS` on it), approved with `passkey`.
 */
export async function setMembersMayInvite(
  client: ClientRoutes<{ orgs: "capabilities" }>,
  org: string,
  team: Pick<AppTeam, "teamId" | "defaultCapabilities">,
  on: boolean,
  passkey: PasskeyProvider,
): Promise<number> {
  const current = team.defaultCapabilities ?? 0;
  const next = on ? current | INVITE : current & ~INVITE;
  await client.orgs.capabilities({ org, team: team.teamId, capabilities: next }, { confirm: passkeyConfirm(passkey) });
  return next;
}

/** One instance that deleting an app team deletes ({@link appTeamInstances}). */
export interface AppTeamInstance {
  appId: string;
  name: string;
  /** The team it is on: the app team, or a team below it (a private channel's). */
  team: string;
}

/**
 * Every instance on app team `teamId` and the teams below it, as the node
 * lists them to the caller (`getTeam`, walking `children`): what
 * `deleteTeam` deletes, with their data. Core's own `412 CONFIRM_REQUIRED`
 * on the delete lists the same set; this reads it without starting a delete
 * (a team holding no instance is deleted without asking). A team below that
 * the caller may not read is left out, so an owner or admin should read it.
 */
export async function appTeamInstances(
  client: ClientRoutes<{ orgs: "teamGet" }>,
  org: string,
  teamId: string,
): Promise<AppTeamInstance[]> {
  const out: AppTeamInstance[] = [];
  const seen = new Set<string>();
  const walk = async (id: string, depth: number): Promise<void> => {
    if (seen.has(id) || depth > 32) return;
    seen.add(id);
    let team;
    try {
      team = await client.orgs.teamGet({ org, team: id });
    } catch (e) {
      // The app team itself must be readable; one below may not be.
      if (id === teamId) throw e;
      return;
    }
    for (const a of team.apps ?? []) {
      const app = a as { appId?: unknown; name?: unknown };
      if (typeof app.appId === "string") {
        out.push({ appId: app.appId, name: typeof app.name === "string" ? app.name : app.appId, team: id });
      }
    }
    for (const child of team.children ?? []) await walk(child, depth + 1);
  };
  await walk(teamId, 0);
  return out;

}

/**
 * Open `team` (an app team) to everyone in the organization: `updateTeam`
 * with `join: "everyone"`. It only widens: its rows stay, and whoever was
 * taken out of it stays out (core keeps them in the team's `removed`). Core
 * asks no passkey for it (rc.14), only `MANAGE_VISIBILITY` on the team, which
 * its managers (owners, admins, its leads) hold.
 */
export async function openAppTeam(
  client: ClientRoutes<{ orgs: "teamUpdate" }>,
  org: string,
  team: Pick<AppTeam, "teamId">,
): Promise<void> {
  await client.orgs.teamUpdate({ org, team: team.teamId, join: "everyone" });
}

/**
 * Open every closed one of `teams`, one `updateTeam` each, in turn (no
 * passkey). Answers the team ids opened; a refusal is thrown with those
 * before it already open.
 */
export async function openAppTeams(
  client: ClientRoutes<{ orgs: "teamUpdate" }>,
  org: string,
  teams: ReadonlyArray<Pick<AppTeam, "teamId" | "join">>,
): Promise<string[]> {
  const opened: string[] = [];
  for (const t of teams) {
    if (t.join === "everyone") continue;
    await openAppTeam(client, org, t);
    opened.push(t.teamId);
  }
  return opened;
}

/**
 * Turn "keep apps apart" on: close every app team in `org` (core `ScopeApps`
 * with no package and `shared: true`; owner or admin; one passkey). Core
 * writes everyone inside each open team now in as a row of their own in the
 * same step (every member who joins open teams; not a guest, nor someone
 * taken out of that app before), so nobody who has an app loses it, and
 * turns "members may invite" off on those apps. From then on, someone who joins the org gets
 * only the apps an invite names. A legacy app (organization access, no team)
 * is left as it is. Core has no per-app close that keeps people: an
 * `updateTeam` to `join: "invite"` drops everyone who was in only because the
 * team was open, so nothing here offers it.
 */
export async function keepAppsApart(
  client: ClientRoutes<{ orgs: "appTeamsScope" }>,
  org: string,
  passkey: PasskeyProvider,
): Promise<OrgMode> {
  const result = await client.orgs.appTeamsScope({ org, apps: [], shared: true }, { confirm: passkeyConfirm(passkey) });
  return result.mode;
}
