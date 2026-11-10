/**
 * Which of the account's organizations an app offers, the same in every app.
 *
 * An account is in organizations made for other apps (a Mero Blocks world, a
 * chat workspace). Those are not this app's: its default list holds only the
 * organizations that already hold an instance of this app's package
 * ({@link orgsWithApp}), so signing in never offers or enters one made for
 * something else. Putting this app into another organization is a separate,
 * explicit choice ({@link otherOrgs}): the account's other organizations where
 * it may create apps, each labelled with what it holds already.
 *
 * Core's `/me` lists every organization of the account with no package
 * filter; `GET /apps?package=` answers this app's instances with their `org`,
 * so the organizations holding this app are `me.orgs` ∩ those.
 */
import type { AppInfo, AppTeams, CalimeroClient, OrgMode } from "@calimero-network/mero-js";

import { appTeams } from "./appTeams";
import { mayCreateIn, type OrgAccessView } from "./invite";
import type { AppSource } from "./target";

/** An organization the account is in, as `/me` lists it. */
export interface MyOrg {
  orgId: string;
  name: string;
  /** `owner`, `admin`, `member` or `guest`. */
  role: string;
}

/** An app instance an organization holds, for its label. */
export interface OrgHolding {
  appId: string;
  name: string;
  package: string | null;
}

/** One of the account's other organizations ({@link otherOrgs}). */
export interface OtherOrg extends MyOrg {
  /** The app instances it holds that this account reaches. */
  holds: OrgHolding[];
  /**
   * Its app teams (one per app installed there), on a node with app teams
   * (core#4890); `null` (or absent) on an older node, where `holds` is all there is.
   */
  apps?: AppTeams["appTeams"] | null;
  /** How it holds its apps; `null` (or absent) on a node without app teams. */
  mode?: OrgMode | null;
  /**
   * What it holds, in words: its apps by name ({@link appTeamsLabel}) where the
   * node lists app teams, else the instances this account reaches
   * ("Mero Blocks: overworld", {@link holdingsLabel}).
   */
  label: string;
  /** Whether this account may create an app there; `null` when it cannot be told (the node decides). */
  canCreate: boolean | null;
}

/** The `listApps` filter for `source`: a bundle hash in development, else the package. */
export function appFilter(source: AppSource): { bundle: string } | { package: string } {
  return typeof source === "string" ? { bundle: source } : { package: source.package };
}

/** Every organization the account is in (`/me`), by name. */
export async function myOrgs(client: Pick<CalimeroClient, "me">): Promise<MyOrg[]> {
  const me = (await client.me()) as { orgs?: Array<{ orgId?: unknown; name?: unknown; role?: unknown }> };
  return (me.orgs ?? [])
    .filter((o): o is { orgId: string; name?: unknown; role?: unknown } => typeof o.orgId === "string" && !!o.orgId)
    .map((o) => ({
      orgId: o.orgId,
      name: typeof o.name === "string" ? o.name : "",
      role: typeof o.role === "string" ? o.role : "member",
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.orgId.localeCompare(b.orgId));
}

/**
 * The key an organization made for an app carries in its metadata
 * ({@link markOrgFor}): `{ createdFor: "<package>" }` (the bundle hash in
 * development).
 */
export const CREATED_FOR = "createdFor";

/** What {@link CREATED_FOR} holds for `source`: its package, or the bundle hash. */
export function appKey(source: AppSource): string {
  return typeof source === "string" ? source : source.package;
}

/** Whether org `metadata` says it was made for `source` ({@link markOrgFor}). */
export function isMarkedFor(metadata: unknown, source: AppSource): boolean {
  return (
    !!metadata &&
    typeof metadata === "object" &&
    (metadata as Record<string, unknown>)[CREATED_FOR] === appKey(source)
  );
}

/**
 * Records in a new organization's metadata that it was made for this app, so
 * it stays in the app's list ({@link orgsWithApp} with `marked`) before it
 * holds an instance: an app whose organizations start empty (a forum space, a
 * password team) creates the org first and its instances after. Merges with
 * what the metadata holds; best-effort (`false` when the node refused it).
 */
export async function markOrgFor(
  client: Pick<CalimeroClient, "getOrg" | "setOrgMetadata">,
  org: string,
  source: AppSource,
): Promise<boolean> {
  try {
    const current = (await client.getOrg(org).catch(() => null)) as { metadata?: unknown } | null;
    const base =
      current?.metadata && typeof current.metadata === "object" && !Array.isArray(current.metadata)
        ? (current.metadata as Record<string, unknown>)
        : {};
    await client.setOrgMetadata(org, { ...base, [CREATED_FOR]: appKey(source) });
    return true;
  } catch {
    return false;
  }
}

export interface OrgsWithAppOptions {
  /**
   * Also the organizations made for this app that hold no instance yet
   * ({@link markOrgFor}); reads each other organization (`getOrg`).
   */
  marked?: boolean;
}

/** The org ids holding one of `apps`. */
function orgIds(apps: AppInfo[]): Set<string> {
  return new Set(apps.map((a) => a.org).filter((o): o is string => typeof o === "string" && !!o));
}

/**
 * The account's organizations that hold an instance of this app (`source`,
 * from `appSource`): the only ones an app lists, resumes or enters by
 * default. An organization made for another app is not among them.
 */
export async function orgsWithApp(
  client: Pick<CalimeroClient, "me" | "listApps"> & Partial<Pick<CalimeroClient, "getOrg">>,
  source: AppSource,
  options: OrgsWithAppOptions = {},
): Promise<MyOrg[]> {
  const [orgs, apps] = await Promise.all([myOrgs(client), client.listApps(appFilter(source))]);
  const held = orgIds(apps);
  if (!options.marked || !client.getOrg) return orgs.filter((o) => held.has(o.orgId));
  const getOrg = client.getOrg.bind(client);
  const keep = await Promise.all(
    orgs.map(async (o) => {
      if (held.has(o.orgId)) return true;
      const view = (await getOrg(o.orgId).catch(() => null)) as { metadata?: unknown } | null;
      return isMarkedFor(view?.metadata, source);
    }),
  );
  return orgs.filter((_, i) => keep[i]);
}

const KNOWN_TITLES: Record<string, string> = {
  chat: "Mero Chat",
  docs: "Mero Docs",
  "mero-drive-docs": "Mero Docs",
  "kv-store": "KV Store",
};

/** A package id in words: `com.calimero.mero-blocks` is "Mero Blocks". */
export function packageTitle(pkg: string): string {
  const last = pkg.split(".").pop() || pkg;
  const known = KNOWN_TITLES[last];
  if (known) return known;
  return last
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * What an organization holds, in words: "Mero Blocks: overworld", several
 * joined by ", ", and "No apps yet" when it holds none this account reaches.
 */
export function holdingsLabel(holds: readonly OrgHolding[]): string {
  if (holds.length === 0) return "No apps yet";
  return holds
    .map((h) => {
      const title = h.package ? packageTitle(h.package) : "";
      return title ? (h.name ? `${title}: ${h.name}` : title) : h.name || h.appId;
    })
    .join(", ");
}

/**
 * An org's apps in words, from its app teams: "Mero Chat, Mero Blocks", with
 * the ones this account is not in marked "(not yours)". An org whose apps
 * this account does not reach still holds them, which the instance list
 * ({@link holdingsLabel}) cannot see: it said "No apps yet" for a shared org
 * whose apps were all closed to the account. `null` when there are no app
 * teams to go by (a legacy org), so the caller falls back to the instances.
 */
export function appTeamsLabel(teams: AppTeams["appTeams"]): string | null {
  if (teams.length === 0) return null;
  return [...teams]
    .sort((a, b) => a.name.localeCompare(b.name) || a.package.localeCompare(b.package))
    .map((t) => {
      const title = t.name || packageTitle(t.package);
      return t.member ? title : `${title} (not yours)`;
    })
    .join(", ");
}

export interface OtherOrgsOptions {
  /** Also list organizations where this account may not create apps (default: left out). */
  includeNotAllowed?: boolean;
}

/**
 * The account's other organizations: those that do not hold this app yet,
 * where it may create one (core's `CREATE_APP`, see `canCreateIn`), each with
 * what it holds and its {@link holdingsLabel}. What "Connect to an existing
 * organization" offers: never a default, never preselected. Choosing one
 * creates this app's instance there (`createApp(name, source, { org })`).
 */
export async function otherOrgs(
  client: Pick<CalimeroClient, "me" | "listApps" | "getOrg" | "session"> & Partial<Pick<CalimeroClient, "listAppTeams">>,
  source: AppSource,
  options: OtherOrgsOptions = {},
): Promise<OtherOrg[]> {
  const [orgs, mine, all] = await Promise.all([
    myOrgs(client),
    client.listApps(appFilter(source)),
    client.listApps().catch(() => [] as AppInfo[]),
  ]);
  const held = orgIds(mine);
  const account = client.session?.accountId ?? null;
  const rows = await Promise.all(
    orgs
      .filter((o) => !held.has(o.orgId))
      .map(async (o): Promise<OtherOrg & { marked: boolean }> => {
        const holds = all
          .filter((a) => a.org === o.orgId)
          .map((a) => ({ appId: a.appId, name: a.name, package: a.package ?? null }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
        let canCreate: boolean | null = null;
        let marked = false;
        const view = (await client.getOrg(o.orgId).catch(() => null)) as (OrgAccessView & { metadata?: unknown }) | null;
        if (view) {
          marked = isMarkedFor(view.metadata, source);
          if (account) canCreate = mayCreateIn(view, account);
        }
        const teams = await teamsOf(client, o.orgId);
        // In an org with app teams, only an owner or admin installs an app
        // that has no team there yet (core#4890, decision 4).
        const pkg = typeof source === "string" ? null : source.package;
        if (
          canCreate === true &&
          teams &&
          teams.mode !== "legacy" &&
          !(pkg && teams.appTeams.some((t) => t.package === pkg)) &&
          o.role !== "owner" &&
          o.role !== "admin"
        ) {
          canCreate = false;
        }
        const label = (teams && appTeamsLabel(teams.appTeams)) ?? holdingsLabel(holds);
        return { ...o, holds, apps: teams?.appTeams ?? null, mode: teams?.mode ?? null, label, canCreate, marked };
      }),
  );
  // An org made for this app is in its own list already ({@link orgsWithApp} `marked`).
  const others = rows.filter((o) => !o.marked).map(({ marked: _marked, ...o }) => o as OtherOrg);
  return options.includeNotAllowed ? others : others.filter((o) => o.canCreate !== false);
}

/** {@link appTeams}, or `null` for a client without the method or any failure: the label falls back. */
async function teamsOf(
  client: Partial<Pick<CalimeroClient, "listAppTeams">>,
  org: string,
): Promise<AppTeams | null> {
  if (typeof client.listAppTeams !== "function") return null;
  try {
    return await appTeams(client as Pick<CalimeroClient, "listAppTeams">, org);
  } catch {
    return null;
  }
}
