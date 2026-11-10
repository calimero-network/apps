/**
 * What Calimero Home reads and decides, without React: an organization's
 * people, its apps (one app team per installed package) and who may do what.
 *
 * Home keeps no state of its own. Everything here is core's org routes through
 * mero-js (`getOrg`, `listAppTeams`, `getTeam`, `listInvites`, `scopeApps`, …).
 * Core enforces every rule; Home only decides what to offer:
 *
 * 1. Members invite to their app in a standalone org; in a shared org only
 *    leads and admins, unless an admin turns on "members may invite" for that
 *    app (the team's default capabilities, `INVITE_MEMBERS`).
 * 2. A member of a shared org sees only the people sharing an app with them,
 *    admins see everyone: core filters `getOrg`'s members, Home shows them.
 * 3. A guest is app-only: no directory (no People screen).
 * 4. Only admins install apps (make app teams).
 * 6. Admins can remove someone from the org, and so from every app in it.
 */
import {
  appTeams,
  appUrl,
  membersMayInvite,
  packageTitle,
} from "@calimero-apps/connect";
import type {
  AppInfo,
  AppTeam,
  CalimeroClient,
  OrgInvite,
  OrgMode,
} from "@calimero-network/mero-js";

/** Home's own package: one first-party package every cluster serves. */
export const PACKAGE = "com.calimero.mero-home";

export type Role = "owner" | "admin" | "member" | "guest";

const ROLE_ORDER: Record<Role, number> = { owner: 0, admin: 1, member: 2, guest: 3 };

function asRole(v: unknown): Role {
  return v === "owner" || v === "admin" || v === "guest" ? v : "member";
}

export function isAdmin(role: Role | null): boolean {
  return role === "owner" || role === "admin";
}

export function roleLabel(role: Role): string {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

/** One person in the organization, as the caller may see them (core filters the list). */
export interface Person {
  account: string;
  role: Role;
  /** Their display name from member metadata, else `null`. */
  name: string | null;
}

/** The people `getOrg` answers (owners first, then by name), already filtered by core. */
export function peopleOf(info: Record<string, unknown>): Person[] {
  const members = (info.members ?? {}) as Record<string, unknown>;
  const meta = (info.memberMetadata ?? {}) as Record<string, unknown>;
  return Object.entries(members)
    .map(([account, role]) => {
      const m = meta[account] as { name?: unknown } | null | undefined;
      const name = typeof m?.name === "string" && m.name.trim() ? m.name.trim() : null;
      return { account, role: asRole(role), name };
    })
    .sort(
      (a, b) =>
        ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
        (a.name ?? "￿").localeCompare(b.name ?? "￿") ||
        a.account.localeCompare(b.account),
    );
}

/** A short form of an account id for the UI. */
export function shortAccount(account: string): string {
  return account.length > 14 ? `${account.slice(0, 6)}…${account.slice(-4)}` : account;
}

export function displayName(p: Pick<Person, "account" | "name">): string {
  return p.name ?? shortAccount(p.account);
}

/** One app the organization holds, for the Apps and Admin screens. */
export interface OrgApp {
  package: string;
  name: string;
  /** Its app team; `null` for a legacy app (organization access: everyone in the org). */
  team: AppTeam | null;
  /** The instances the caller reaches (legacy apps only: an app team's are the app's business). */
  instances: AppInfo[];
}

/** An organization as Home shows it. */
export interface OrgView {
  org: string;
  name: string;
  /** `null` on a node without app teams (before core#4890). */
  mode: OrgMode | null;
  /** The caller's role there. */
  role: Role | null;
  people: Person[];
  apps: OrgApp[];
}

/**
 * Reads `org`: its people (`getOrg`, filtered by core), its app teams
 * (`listAppTeams`; `null` on an older node) and the instances the caller
 * reaches there (`listApps`), grouped by package. A package with an app team
 * is listed once under it; one without is a legacy app, open to everyone.
 */
export async function loadOrg(
  client: Pick<CalimeroClient, "getOrg" | "listAppTeams" | "listApps">,
  org: string,
  account: string,
): Promise<OrgView> {
  const [info, teams, reached] = await Promise.all([
    client.getOrg(org),
    appTeams(client, org),
    client.listApps().catch(() => [] as AppInfo[]),
  ]);
  const inOrg = reached.filter((a) => a.org === org);
  const apps: OrgApp[] = (teams?.appTeams ?? []).map((team) => ({
    package: team.package,
    name: team.name || packageTitle(team.package),
    team,
    instances: inOrg.filter((a) => a.package === team.package),
  }));
  const withTeam = new Set(apps.map((a) => a.package));
  const legacy = new Map<string, AppInfo[]>();
  for (const a of inOrg) {
    if (!a.package || withTeam.has(a.package) || a.package === PACKAGE) continue;
    legacy.set(a.package, [...(legacy.get(a.package) ?? []), a]);
  }
  for (const [pkg, instances] of legacy) {
    apps.push({ package: pkg, name: packageTitle(pkg), team: null, instances });
  }
  apps.sort((a, b) => a.name.localeCompare(b.name) || a.package.localeCompare(b.package));
  const members = (info.members ?? {}) as Record<string, unknown>;
  const mode = teams?.mode ?? (typeof info.mode === "string" ? info.mode : null);
  return {
    org,
    name: typeof info.name === "string" ? info.name : org,
    mode,
    role: account in members ? asRole(members[account]) : null,
    people: peopleOf(info),
    apps,
  };
}

/** The link that opens `pkg` in `org` (and its app team): the copy its cluster serves. */
export function openLink(pkg: string, org: string, team?: string | null, appsDomain?: string): string {
  const url = new URL(appUrl(pkg, appsDomain));
  url.searchParams.set("org", org);
  if (team) url.searchParams.set("team", team);
  return url.toString();
}

/** The apps the caller is in ("Your apps"): their app teams, and legacy apps they reach. */
export function yourApps(view: OrgView): OrgApp[] {
  return view.apps.filter((a) => (a.team ? a.team.member : a.instances.length > 0));
}

/** The apps an admin sees but is not in. */
export function otherApps(view: OrgView): OrgApp[] {
  return isAdmin(view.role) ? view.apps.filter((a) => !yourApps(view).includes(a)) : [];
}

/** Who has the app, in words: "Everyone in the organization" or "4 people". */
export function audience(app: OrgApp): string {
  if (!app.team || app.team.join === "everyone") return "Everyone in the organization";
  const n = app.team.memberCount;
  return n === 1 ? "1 person" : `${n} people`;
}

/**
 * The app teams the caller may name in an invite (decision 1): every one for
 * an admin; else those they lead, and those they are in whose "members may
 * invite" switch is on (always on in a standalone org).
 */
export function invitableApps(view: OrgView): OrgApp[] {
  return view.apps.filter((a) => {
    if (!a.team) return false;
    if (isAdmin(view.role) || a.team.manages) return true;
    return a.team.member && membersMayInvite(a.team);
  });
}

/** Whether the caller gets the Invitations screen: an admin, or someone who may invite to an app. */
export function mayInviteHere(view: OrgView): boolean {
  if (view.role === "guest") return false;
  if (isAdmin(view.role)) return true;
  return invitableApps(view).length > 0;
}

/** The screens Home offers the caller in this org. */
export type Screen = "apps" | "people" | "invitations" | "admin";

export function screensFor(view: OrgView): Screen[] {
  const screens: Screen[] = ["apps"];
  // Decision 3: a guest is app-only and has no directory.
  if (view.role !== "guest") screens.push("people");
  if (mayInviteHere(view)) screens.push("invitations");
  // Decision 4: only admins install apps and set up their teams.
  if (isAdmin(view.role)) screens.push("admin");
  return screens;
}

/** Where each person is, per app team: `lead`, `member` or `readOnly`, from `getTeam`. */
export type Rosters = Map<string, Map<string, "lead" | "member" | "readOnly">>;

/**
 * The direct rows of every closed app team the caller sees (an open team holds
 * everyone in the org, so it needs no read). A team the caller may not read is
 * left out rather than failing the screen.
 */
export async function loadRosters(
  client: Pick<CalimeroClient, "getTeam">,
  org: string,
  apps: readonly OrgApp[],
): Promise<Rosters> {
  const rosters: Rosters = new Map();
  await Promise.all(
    apps.map(async (a) => {
      if (!a.team || a.team.join === "everyone") return;
      try {
        const t = await client.getTeam(org, a.team.teamId);
        rosters.set(a.team.teamId, new Map(t.members.map((m) => [m.account, m.role])));
      } catch {
        /* not readable by this caller: the column says so */
      }
    }),
  );
  return rosters;
}

export type Cell = "all" | "lead" | "member" | "readOnly" | "none" | "unknown";

/**
 * One cell of the People matrix: what `person` has in `app`. An open team (or
 * a legacy app) is everyone's, except a guest's once the org has app teams:
 * guests inherit no open team and reach no organization-access app then.
 */
export function accessCell(view: Pick<OrgView, "mode">, app: OrgApp, rosters: Rosters, person: Person): Cell {
  const moded = view.mode === "standalone" || view.mode === "shared";
  if (!app.team || app.team.join === "everyone") {
    if (person.role === "guest" && moded) return app.team ? (rosters.get(app.team.teamId)?.get(person.account) ?? "none") : "none";
    return "all";
  }
  const roster = rosters.get(app.team.teamId);
  if (!roster) return "unknown";
  return roster.get(person.account) ?? "none";
}

/** The apps a removal from the org takes the person out of (decision 6): every app they have. */
export function appsOf(view: OrgView, rosters: Rosters, person: Person): OrgApp[] {
  return view.apps.filter((a) => {
    const cell = accessCell(view, a, rosters, person);
    return cell !== "none";
  });
}

/** An invite's teams by app name, for the pending list: "Chat, Blocks", or "Organization only". */
export function inviteApps(invite: Pick<OrgInvite, "teams">, view: OrgView): string {
  if (invite.teams.length === 0) return "Organization only";
  return invite.teams
    .map((t) => view.apps.find((a) => a.team?.teamId === t)?.name ?? "a team you do not see")
    .join(", ");
}

/** When an invite ends, in words, relative to `now` (ms). */
export function inviteExpiry(invite: Pick<OrgInvite, "expiresAt" | "expired">, now: number = Date.now()): string {
  if (invite.expired || invite.expiresAt * 1000 <= now) return "Expired";
  const secs = invite.expiresAt - Math.floor(now / 1000);
  if (secs < 3600) return `Expires in ${Math.max(1, Math.round(secs / 60))} min`;
  if (secs < 86_400) return `Expires in ${Math.round(secs / 3600)} h`;
  const days = Math.round(secs / 86_400);
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

/** The lifetimes the invite form offers, in seconds. */
export const TTL_CHOICES: ReadonlyArray<{ label: string; secs: number }> = [
  { label: "1 day", secs: 86_400 },
  { label: "7 days", secs: 7 * 86_400 },
  { label: "30 days", secs: 30 * 86_400 },
];

/** Installed packages Home can set up in an org: those without an app team there yet, Home itself left out. */
export function installable(packages: ReadonlyArray<{ package: string }>, view: OrgView): string[] {
  const has = new Set(view.apps.filter((a) => a.team).map((a) => a.package));
  return packages
    .map((p) => p.package)
    .filter((p) => p !== PACKAGE && !has.has(p))
    .sort((a, b) => packageTitle(a).localeCompare(packageTitle(b)));
}

/** The mode in words, for the org header. */
export function modeLabel(mode: OrgMode | null): string {
  switch (mode) {
    case "shared":
      return "Shared: each app lists who is in it";
    case "standalone":
      return "Standalone: everyone has its app";
    case "legacy":
      return "Everyone in the organization has every app";
    default:
      return "This cluster does not list app teams yet";
  }
}
