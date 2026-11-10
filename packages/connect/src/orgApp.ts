/**
 * An org app's workspace: the one module every app that keeps its people in
 * an organization calls to create one, add itself to one, invite, list its
 * people, remove someone and leave. `scripts/check-org-app-module.py` fails
 * CI when an org app calls `createOrg`, `scopeApps`/`createAppTeam`,
 * `invite`, `removeMember` or `removeTeamMember` itself.
 *
 * Each app gets its own **app team** in the organization ({@link ./appTeams},
 * core#4890), and the organization's mode decides what its screens mean:
 *
 * - `legacy` (no app team; also a node without app-team routes, and an app
 *   run from a raw bundle under `pnpm dev:local`, which has no package): the
 *   org is the app's, organization access, as before app teams.
 * - `standalone` (open app teams): every app is everyone's in the org. A new
 *   org is made this way, and it stays open however many apps it holds
 *   until an admin keeps the apps apart in Calimero Home. Invites, Remove and
 *   Leave are the organization's, as in legacy.
 * - `shared` (closed app teams, "keep apps apart"): an invite gives this app
 *   only, its member list is its team, and Remove and Leave take someone out
 *   of this app, never out of the organization.
 *
 * A team made from here is open (`shared: false`) unless the org is shared
 * already, where it is closed like the others; `shared` is always passed,
 * because core closes every team on its own once an org holds two.
 */
import type { CalimeroClient, OrgMode, PasskeyProvider } from "@calimero-network/mero-js";

import { appTeamMembers, appTeams, createAppTeam, inviteToApp } from "./appTeams";
import type { OrgAccessView, OrgTeamView } from "./invite";
import { markOrgFor } from "./orgs";
import type { AppSource } from "./target";

/** A passkey provider, or what makes one per prompt (`passkey()` in most apps). */
export type PasskeyLike = PasskeyProvider | (() => PasskeyProvider);

function provider(passkey: PasskeyLike): PasskeyProvider {
  return typeof passkey === "function" ? passkey() : passkey;
}

const ADMIN = new Set(["owner", "admin"]);

// ── reading an org ──────────────────────────────────────────────────────────

/** The package an app runs from; `null` for a raw bundle (`pnpm dev:local`), which has no app team. */
export function sourcePackage(source: AppSource | null | undefined): string | null {
  if (!source || typeof source === "string") return null;
  return source.package || null;
}

/** `getOrg` as this module reads it: the access view, the org's mode, each team's metadata. */
export interface AppOrgView extends OrgAccessView {
  mode?: unknown;
  teams?: Record<string, (OrgTeamView & { metadata?: unknown }) | undefined>;
}

/** The org's mode as `getOrg` gives it; `null` on a node that does not say (no app teams there). */
export function orgModeOf(view: Pick<AppOrgView, "mode">): OrgMode | null {
  const mode = view.mode;
  return mode === "legacy" || mode === "standalone" || mode === "shared" ? mode : null;
}

/** Whether the org has app teams (`standalone` or `shared`): a guest then reaches no organization-access app. */
function moded(mode: OrgMode | null): boolean {
  return mode === "standalone" || mode === "shared";
}

/**
 * `pkg`'s app team in a `getOrg` view: the top-level team whose
 * `metadata.app.package` is `pkg`. `null` without a package, without one, or
 * for a closed team the caller does not see.
 */
export function appTeamIdIn(view: AppOrgView, pkg: string | null): string | null {
  if (!pkg) return null;
  for (const [id, team] of Object.entries(view.teams ?? {})) {
    if (!team || team.parent) continue;
    const app = (team.metadata as { app?: { package?: unknown } } | null | undefined)?.app;
    if (app?.package === pkg) return id;
  }
  return null;
}

/**
 * Who has `pkg` in this org, in org order: its app team
 * ({@link appTeamMembers}); without one, every org member, except a guest
 * once the org has app teams. What an app's member list shows.
 */
export function appPeople(view: AppOrgView, pkg: string | null): string[] {
  const mode = orgModeOf(view);
  const team = appTeamIdIn(view, pkg);
  if (team) return appTeamMembers(view, team, mode);
  return Object.entries(view.members ?? {})
    .filter(([, role]) => !(role === "guest" && moded(mode)))
    .map(([account]) => account);
}

/**
 * Whether `pkg` keeps its own people in this org: the org is `shared` (an
 * admin keeps its apps apart) and the app has its team there. An invite then
 * gives this app only, and Remove and Leave are this app's, not the org's.
 */
export function isAppOnly(view: AppOrgView, pkg: string | null): boolean {
  return orgModeOf(view) === "shared" && appTeamIdIn(view, pkg) !== null;
}

/** The line an invite dialog shows when its link gives `appName` only ({@link AppInviteToken.appOnly}). */
export function appOnlyInviteNote(appName: string): string {
  return `Invites to ${appName} only: this organization's other apps are managed in Calimero Home.`;
}

// ── creating a workspace, adding the app to an org ──────────────────────────

/**
 * Gives `source`'s package its app team in `org` (core `ScopeApps`; owner or
 * admin, one passkey): open, unless the org is shared already. `null` under
 * a raw bundle. Throws what the node answers (declined, an older node).
 */
export async function adoptAppTeam(
  client: Pick<CalimeroClient, "getOrg" | "scopeApps">,
  org: string,
  source: AppSource | null | undefined,
  passkey: PasskeyLike,
): Promise<string | null> {
  const pkg = sourcePackage(source);
  if (!pkg) return null;
  const view = (await client.getOrg(org)) as AppOrgView;
  const made = await createAppTeam(client, org, pkg, provider(passkey), { shared: orgModeOf(view) === "shared" });
  return made.teamId;
}

export interface CreateAppOrgOptions {
  /** The org's default capabilities for members (a passkey step-up); absent: the node's default. */
  capabilities?: number;
  /** Mark the org as made for this app, so it is listed before it holds an instance (default true). */
  mark?: boolean;
}

/** What {@link createAppOrg} made. */
export interface CreatedAppOrg {
  orgId: string;
  /** The app's open team; `null` when it was not made (declined, an older node, a raw bundle): a legacy org. */
  teamId: string | null;
  /** Why the member defaults were not set (a declined passkey), `null` when they were or none were asked. */
  capabilitiesError: unknown;
}

/**
 * A new workspace for `source`'s app: `createOrg`, marked as made for the
 * app, its member defaults, and the app's own team, open (standalone).
 * Neither later step fails the workspace: declined defaults come back as
 * `capabilitiesError`, and without a team (declined, a node without app-team
 * routes, a raw bundle) the org is a legacy one, as every org was before.
 */
export async function createAppOrg(
  client: Pick<CalimeroClient, "createOrg" | "getOrg" | "setOrgMetadata" | "setCapabilities" | "scopeApps">,
  name: string,
  source: AppSource | null | undefined,
  passkey: PasskeyLike,
  options: CreateAppOrgOptions = {},
): Promise<CreatedAppOrg> {
  const orgId = await client.createOrg(name);
  if (source && options.mark !== false) await markOrgFor(client, orgId, source);
  let capabilitiesError: unknown = null;
  if (options.capabilities !== undefined) {
    try {
      await client.setCapabilities(orgId, options.capabilities, provider(passkey), {});
    } catch (e) {
      capabilitiesError = e ?? new Error("member defaults not set");
    }
  }
  let teamId: string | null = null;
  try {
    teamId = await adoptAppTeam(client, orgId, source, passkey);
  } catch (e) {
    console.warn("createAppOrg: the app's team was not made; the org is a legacy one", e);
  }
  return { orgId, teamId, capabilitiesError };
}

/** Thrown by {@link orgWideAccess}: the org's apps have teams, this one has none, and only an owner or admin may add it. */
export class AppTeamAdminError extends Error {
  readonly package: string;
  constructor(pkg: string, appName: string) {
    super(`Only this organization's owners and admins can add ${appName} to it.`);
    this.name = "AppTeamAdminError";
    this.package = pkg;
  }
}

/** The access of an org-wide instance: the app's team, or (no app team) the whole org. */
export type OrgWideAccess = { kind: "team"; team: string } | { kind: "org" };

/**
 * The `access` for a new org-wide instance of `source` in `org`, which is
 * also how the app is added to an existing org: its app team where it has
 * one. An org whose apps have teams but none for this one gets it first, in
 * the org's mode (open unless shared), which only an owner or admin may do
 * ({@link AppTeamAdminError} for anyone else, before anything is made). A
 * legacy org, a node that does not say, or a raw bundle keeps organization
 * access: moving a legacy org onto app teams is an admin's choice in
 * Calimero Home, never forced from an app.
 */
export async function orgWideAccess(
  client: Pick<CalimeroClient, "getOrg" | "scopeApps" | "session">,
  org: string,
  source: AppSource | null | undefined,
  passkey: PasskeyLike,
  appName: string,
): Promise<OrgWideAccess> {
  const pkg = sourcePackage(source);
  if (!pkg) return { kind: "org" };
  const view = (await client.getOrg(org)) as AppOrgView;
  const team = appTeamIdIn(view, pkg);
  if (team) return { kind: "team", team };
  if (!moded(orgModeOf(view))) return { kind: "org" };
  const account = client.session?.accountId ?? "";
  if (!ADMIN.has(view.members?.[account] ?? "")) throw new AppTeamAdminError(pkg, appName);
  const made = await createAppTeam(client, org, pkg, provider(passkey), { shared: orgModeOf(view) === "shared" });
  return { kind: "team", team: made.teamId };
}

/**
 * `createApp`'s options for a new org-wide instance ({@link orgWideAccess}):
 * `{ org, access }` on the app's team, and `{ org }` alone where that is
 * organization access, exactly what an app sent before app teams (core makes
 * an org instance `org` access by default), so a legacy org is unchanged.
 */
export async function orgInstanceOptions(
  client: Pick<CalimeroClient, "getOrg" | "scopeApps" | "session">,
  org: string,
  source: AppSource | null | undefined,
  passkey: PasskeyLike,
  appName: string,
): Promise<{ org: string; access?: OrgWideAccess }> {
  const access = await orgWideAccess(client, org, source, passkey, appName);
  return access.kind === "team" ? { org, access } : { org };
}

// ── invites ─────────────────────────────────────────────────────────────────

/** What {@link appInvite} made. */
export interface AppInviteToken {
  token: string;
  /** The link gives this app only: it names the app team of a `shared` org. */
  appOnly: boolean;
}

/**
 * An invite into `org` as a member for `source`'s app, naming its app team
 * (`inviteToApp`), so in a shared org it gives this app and no other. The
 * org-wide invite where the org has no app teams (legacy, an older node) or
 * under a raw bundle; in an org with app teams but none for this app it is
 * refused (`NoAppTeamError`) rather than widened to the whole org. `teams` adds more (a private vault's or folder's team).
 */
export async function appInvite(
  client: Pick<CalimeroClient, "listAppTeams" | "invite">,
  org: string,
  source: AppSource | null | undefined,
  passkey: PasskeyLike,
  options: { teams?: string[] } = {},
): Promise<AppInviteToken> {
  const pkg = sourcePackage(source);
  if (!pkg) {
    const teams = options.teams ?? [];
    const token =
      teams.length > 0
        ? await client.invite(org, "member", provider(passkey), teams)
        : await client.invite(org, "member", provider(passkey));
    return { token, appOnly: false };
  }
  const made = await inviteToApp(client, org, pkg, {
    passkey: provider(passkey),
    ...(options.teams?.length ? { teams: options.teams } : {}),
  });
  return { token: made.token, appOnly: made.mode === "shared" && made.teams.length > 0 };
}

// ── removing and leaving ────────────────────────────────────────────────────

export interface RemoveFromAppOptions {
  /**
   * The app's private lists in the org (a private vault's or folder's team)
   * to take the person off too, in a shared org. Each is tried on its own:
   * one the remover may not change is left as it is.
   */
  privateTeams?: (view: AppOrgView) => string[];
}

/**
 * Takes `account` out of `source`'s app in `org`. In a shared org where the
 * app has its team, that is this app only: off its team, and off the private
 * lists `options.privateTeams` names that the remover may change; the
 * organization and its other apps are Calimero Home's. Anywhere else
 * (standalone and legacy: the org is everyone's apps) it is out of the
 * organization, as before. Answers which it was.
 */
export async function removeFromApp(
  client: Pick<CalimeroClient, "getOrg" | "removeTeamMember" | "removeMember">,
  org: string,
  source: AppSource | null | undefined,
  account: string,
  passkey: PasskeyLike,
  options: RemoveFromAppOptions = {},
): Promise<"app" | "org"> {
  const pkg = sourcePackage(source);
  const view = pkg ? ((await client.getOrg(org)) as AppOrgView) : null;
  const team = view && isAppOnly(view, pkg) ? appTeamIdIn(view, pkg) : null;
  if (!view || !team) {
    await client.removeMember(org, account, provider(passkey));
    return "org";
  }
  if (account in (view.teams?.[team]?.members ?? {})) {
    await client.removeTeamMember(org, team, account, provider(passkey));
  }
  for (const sub of options.privateTeams?.(view) ?? []) {
    if (sub === team || !(account in (view.teams?.[sub]?.members ?? {}))) continue;
    await client.removeTeamMember(org, sub, account, provider(passkey)).catch((e: unknown) => {
      console.warn(`removeFromApp: ${sub} still lists ${account}`, e);
    });
  }
  return "app";
}

/**
 * Takes `account` off one of the app's private lists in `org` (a private
 * folder's or vault's team), approved with `passkey`. An app team is refused:
 * taking someone out of an app is {@link removeFromApp}, which knows the
 * org's mode.
 */
export async function removeFromPrivateTeam(
  client: Pick<CalimeroClient, "getOrg" | "removeTeamMember">,
  org: string,
  team: string,
  account: string,
  passkey: PasskeyLike,
): Promise<void> {
  const view = (await client.getOrg(org)) as AppOrgView;
  const meta = view.teams?.[team]?.metadata as { app?: { package?: unknown } } | null | undefined;
  if (!view.teams?.[team]?.parent && meta?.app?.package) {
    throw new Error("an app's team is left through removeFromApp, which knows the organization's mode");
  }
  await client.removeTeamMember(org, team, account, provider(passkey));
}

/** What {@link leaveApp} did. */
export interface LeftApp {
  /** `app`: off this app's team only (a shared org); `org`: out of the organization. */
  left: "app" | "org";
  /** After leaving the app, the account is in no app team of the org: offer {@link leaveOrg}. */
  lastApp: boolean;
}

/**
 * The signed-in account leaves `source`'s app in `org`. In a shared org
 * (apps kept apart) where the app has its team, that is this app's team only
 * (and the private lists `options.privateTeams` names); when it was their
 * last app there, `lastApp` says so, for the app to offer {@link leaveOrg}.
 * In standalone and legacy orgs it is leaving the organization, as before.
 */
export async function leaveApp(
  client: Pick<CalimeroClient, "getOrg" | "listAppTeams" | "removeTeamMember" | "removeMember" | "session">,
  org: string,
  source: AppSource | null | undefined,
  passkey: PasskeyLike,
  options: RemoveFromAppOptions = {},
): Promise<LeftApp> {
  const self = client.session?.accountId;
  if (!self) throw new Error("Sign in to leave.");
  const left = await removeFromApp(client, org, source, self, passkey, options);
  if (left === "org") return { left, lastApp: false };
  const after = await appTeams(client, org).catch(() => null);
  return { left, lastApp: !!after && !after.appTeams.some((t) => t.member) };
}

/** The signed-in account leaves `org` altogether (every app in it). */
export async function leaveOrg(
  client: Pick<CalimeroClient, "removeMember" | "session">,
  org: string,
  passkey: PasskeyLike,
): Promise<void> {
  const self = client.session?.accountId;
  if (!self) throw new Error("Sign in to leave.");
  await client.removeMember(org, self, provider(passkey));
}
