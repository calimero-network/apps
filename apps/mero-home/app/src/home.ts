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
 *
 * Organization settings (the Organization screen): admins set the name and
 * logo Home shows (org metadata); only the owner transfers ownership or
 * deletes the organization. The recovery key and release approvals stay in
 * the console.
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
  PasskeyProvider,
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

/** The name and logo an organization shows in Home, from its metadata ({@link orgProfile}). */
export interface OrgProfile {
  /** `metadata.displayName`: shown instead of the name it was made with. */
  name: string | null;
  /** `metadata.logo`: an image `data:` URL (the served page's CSP takes no other origin). */
  logo: string | null;
}

/** An organization as Home shows it. */
export interface OrgView {
  org: string;
  /** The name it was made with (core has no rename). */
  name: string;
  /** Its metadata as `getOrg` answers it (an object, else `{}`), which a profile change merges into. */
  metadata: Record<string, unknown>;
  profile: OrgProfile;
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
  const metadata = asObject(info.metadata);
  return {
    org,
    name: typeof info.name === "string" ? info.name : org,
    metadata,
    profile: orgProfile(metadata),
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
export type Screen = "apps" | "people" | "invitations" | "admin" | "settings";

export function screensFor(view: OrgView): Screen[] {
  const screens: Screen[] = ["apps"];
  // Decision 3: a guest is app-only and has no directory.
  if (view.role !== "guest") screens.push("people");
  if (mayInviteHere(view)) screens.push("invitations");
  // Decision 4: only admins install apps and set up their teams.
  if (isAdmin(view.role)) screens.push("admin", "settings");
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

/** What a manager can set one person to in a closed app team. */
export type Seat = "none" | "member" | "lead" | "readOnly";

/**
 * Whether the caller may change who is in `app` from the People matrix: a
 * closed app team they manage (an owner or admin, or its lead), whose rows
 * they could read. An open team (everyone in the org) and a legacy app have
 * no list to change; a person's own row is left to someone else, so a lead
 * cannot drop their own lead by mistake. A guest can be given an app (that is
 * how a guest gets one), never made its lead.
 */
export function mayChangeSeat(view: Pick<OrgView, "role">, app: OrgApp, rosters: Rosters, person: Person, account: string): boolean {
  if (!app.team || app.team.join === "everyone") return false;
  if (!(isAdmin(view.role) || app.team.manages)) return false;
  if (!rosters.has(app.team.teamId)) return false;
  return person.account !== account;
}

/** The seats offered for `person` ({@link mayChangeSeat}): a guest is never offered lead. */
export function seatsFor(person: Pick<Person, "role">): Seat[] {
  return person.role === "guest" ? ["none", "member", "readOnly"] : ["none", "member", "readOnly", "lead"];
}

/**
 * Puts `account` in `app`'s team at `seat`, or takes them out of it (`none`:
 * core#4891 also takes them out of every team below it, a private channel's
 * say), approved with the caller's passkey.
 */
export async function setSeat(
  client: Pick<CalimeroClient, "setTeamMember" | "removeTeamMember">,
  org: string,
  team: string,
  account: string,
  seat: Seat,
  passkey: PasskeyProvider,
): Promise<void> {
  if (seat === "none") {
    await client.removeTeamMember(org, team, account, passkey);
    return;
  }
  await client.setTeamMember(org, team, account, passkey, { role: seat });
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

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
}

/** The most a logo `data:` URL may be: org metadata is at most 16 KiB in all. */
export const MAX_LOGO_CHARS = 12 * 1024;

const LOGO = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

/** Whether `logo` is one Home shows: a base64 image `data:` URL within {@link MAX_LOGO_CHARS}. */
export function isLogo(logo: unknown): logo is string {
  return typeof logo === "string" && logo.length <= MAX_LOGO_CHARS && LOGO.test(logo);
}

/** The name and logo in an organization's metadata. */
export function orgProfile(metadata: unknown): OrgProfile {
  const m = asObject(metadata);
  const name = typeof m.displayName === "string" && m.displayName.trim() ? m.displayName.trim().slice(0, 64) : null;
  return { name, logo: isLogo(m.logo) ? m.logo : null };
}

/** The organization's name as Home shows it: its display name, else the name it was made with. */
export function orgName(view: Pick<OrgView, "name" | "profile">): string {
  return view.profile.name ?? view.name;
}

/**
 * Sets the organization's display name and logo (`setOrgMetadata`; an
 * owner or admin, or a holder of `MANAGE_METADATA`; no passkey). Core
 * replaces the whole metadata, so this writes the current metadata with
 * these two keys changed and every other key (another app's mark) kept; a
 * `null` clears one.
 */
export async function setOrgProfile(
  client: Pick<CalimeroClient, "setOrgMetadata">,
  org: string,
  current: Record<string, unknown>,
  profile: OrgProfile,
): Promise<Record<string, unknown>> {
  const name = profile.name?.trim() ?? "";
  if (name.length > 64) throw new Error("A name is at most 64 characters.");
  if (profile.logo !== null && !isLogo(profile.logo)) throw new Error("That logo is too large: choose a smaller image.");
  const next: Record<string, unknown> = { ...current };
  if (name) next.displayName = name;
  else delete next.displayName;
  if (profile.logo) next.logo = profile.logo;
  else delete next.logo;
  await client.setOrgMetadata(org, next);
  return next;
}

/** Who the owner may hand the organization to: anyone else in it but a guest (admins first). */
export function transferCandidates(view: Pick<OrgView, "people">, account: string): Person[] {
  return view.people.filter((p) => p.account !== account && p.role !== "guest" && p.role !== "owner");
}

/** Whether a typed confirmation matches `name`: the same text, ignoring surrounding spaces. */
export function typedMatches(typed: string, name: string): boolean {
  return typed.trim() === name.trim() && name.trim() !== "";

}

/** Whether the caller manages at least one closed app team: an owner or admin, or a lead of one. */
export function managesAnyApp(view: Pick<OrgView, "role" | "apps">): boolean {
  if (view.role === "guest") return false;
  return view.apps.some((a) => a.team && a.team.join === "invite" && (isAdmin(view.role) || a.team.manages));
}

/** One app a bulk action leaves alone, and why, in words. */
export interface Skipped {
  app: OrgApp;
  why: string;
}

/** What a bulk action ({@link giveAllPlan}, {@link removeAllPlan}) will change, and what it leaves. */
export interface BulkPlan {
  /** The closed app teams it changes, one passkey step-up each. */
  apps: OrgApp[];
  skipped: Skipped[];
}

const SEAT_WORD: Record<"lead" | "member" | "readOnly", string> = { lead: "Lead", member: "Member", readOnly: "Read only" };

/** Why an app outside a person's reach for bulk changes is left alone, or `null` when the caller may change it. */
function bulkBlock(view: Pick<OrgView, "role" | "mode">, app: OrgApp, rosters: Rosters, person: Person): string | null {
  if (!app.team) return "everyone in the organization has it";
  if (app.team.join === "everyone") {
    const moded = view.mode === "standalone" || view.mode === "shared";
    return person.role === "guest" && moded
      ? "open to everyone but guests: invite them to it"
      : "open to everyone in the organization";
  }
  if (!(isAdmin(view.role) || app.team.manages)) return "you do not manage it";
  if (!rosters.has(app.team.teamId)) return "its list could not be read";
  return null;
}

/**
 * "Give all apps": every closed app team the caller manages (and could read)
 * that `person` has no row in, to be added as a Member, one `setTeamMember`
 * (one passkey step-up) each. An app they are in already keeps its row as it
 * is (a Read only seat is not raised); open and legacy apps are theirs
 * already. Core has no batch route for team rows (rc.14), hence one each.
 */
export function giveAllPlan(view: Pick<OrgView, "role" | "mode" | "apps">, rosters: Rosters, person: Person): BulkPlan {
  const plan: BulkPlan = { apps: [], skipped: [] };
  for (const app of view.apps) {
    const why = bulkBlock(view, app, rosters, person);
    if (why) {
      plan.skipped.push({ app, why });
      continue;
    }
    const seat = rosters.get(app.team!.teamId)?.get(person.account);
    if (seat) plan.skipped.push({ app, why: `already in it (${SEAT_WORD[seat]})` });
    else plan.apps.push(app);
  }
  return plan;
}

/**
 * "Remove from all apps" (never from the organization): every closed app team
 * the caller manages that `person` has a row in, one `removeTeamMember` (one
 * passkey step-up) each. Apps they are not in are not listed; an open or
 * legacy app stays theirs while they are in the organization.
 */
export function removeAllPlan(view: Pick<OrgView, "role" | "mode" | "apps">, rosters: Rosters, person: Person): BulkPlan {
  const plan: BulkPlan = { apps: [], skipped: [] };
  for (const app of view.apps) {
    const cell = accessCell(view, app, rosters, person);
    if (cell === "none") continue;
    const why = bulkBlock(view, app, rosters, person);
    if (why) {
      plan.skipped.push({
        app,
        why: !app.team || app.team.join === "everyone" ? "open to everyone in the organization: they keep it while they are in it" : why,
      });
      continue;
    }
    plan.apps.push(app);
  }
  return plan;
}

/** How a bulk run ended ({@link runEach}). */
export interface BulkResult {
  done: OrgApp[];
  /** The app whose step failed, and why; the run stops there. */
  failed: { app: OrgApp; error: unknown } | null;
  /** The apps after a failure, not tried. */
  notTried: OrgApp[];
}

/**
 * Runs `step` for each app in turn (each its own passkey step-up, so one at a
 * time), telling `progress` how many are done. Stops at the first failure, a
 * refusal or a cancelled passkey prompt alike, so a cancel never turns into
 * a prompt for the next app.
 */
export async function runEach(
  apps: readonly OrgApp[],
  step: (app: OrgApp) => Promise<void>,
  progress: (done: number, current: OrgApp | null) => void = () => {},
): Promise<BulkResult> {
  const done: OrgApp[] = [];
  for (let i = 0; i < apps.length; i++) {
    const app = apps[i]!;
    progress(done.length, app);
    try {
      await step(app);
      done.push(app);
    } catch (error) {
      progress(done.length, null);
      return { done, failed: { app, error }, notTried: apps.slice(i + 1) };
    }
  }
  progress(done.length, null);
  return { done, failed: null, notTried: [] };
}

/** The app teams that list their own people (closed), and those open to everyone. */
export function teamsByJoin(view: Pick<OrgView, "apps">): { closed: OrgApp[]; open: OrgApp[]; legacy: OrgApp[] } {
  return {
    closed: view.apps.filter((a) => a.team?.join === "invite"),
    open: view.apps.filter((a) => a.team?.join === "everyone"),
    legacy: view.apps.filter((a) => !a.team),
  };
}
