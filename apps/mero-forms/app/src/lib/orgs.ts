import { type AppInfo, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import {
  appInvite,
  appPeople,
  createAppOrg,
  createInviteStore,
  isAppOnly,
  orgInstanceOptions,
  sourcePackage,
  type AppInviteToken,
  type AppOrgView,
  inviteLink as sharedInviteLink,
  type AppSource,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
} from "@calimero-apps/connect";
import { nodeBasename } from "@calimero-apps/node-served";

/**
 * v1 → Calimero 1.0, for this app:
 *
 * | v1 | here |
 * |---|---|
 * | a workspace: a context of the app | an **app instance** (`createApp(name, source, { org })`) |
 * | the namespace it lives in | an **organization** (`createOrg`) |
 * | a namespace invitation link (deflate + base58) | an **org invite** token in `?invite=` (`invite` is a passkey step-up; `redeemInvite` after sign-in) |
 * | the name a person set for the namespace (`@calimero-apps/names`) | org **member metadata** `{ name }` |
 * | joining the context and waiting for it to sync | nothing: everyone in the app's team reaches its instances |
 *
 * The org gets this app's own **app team** (core#4890), through
 * `@calimero-apps/connect`'s org-app module: a new org's team is open
 * (everyone in the org has the app), workspaces use team access on it,
 * invites name it, and the people offered for the team are its people. Once
 * an admin keeps the org's apps apart in Calimero Home (`shared`), an invite
 * gives Mero Forms only. An org without one (made before app teams, a node
 * without them, a raw dev bundle) is legacy: organization access, as before.
 */

/** The app's name where an owner or admin is told who may add it to an org. */
export const PRODUCT_NAME = "Mero Forms";

/** An org this account is in. */
export interface OrgRow {
  orgId: string;
  name: string;
  /** `owner` | `admin` | `member` | `guest`. */
  role: string;
}

/** A workspace: an instance of this app. */
export interface WorkspaceRow {
  appId: string;
  name: string;
  org: string | null;
  owner: string;
}

interface MeOrgs {
  orgs?: Array<{ orgId: string; name: string; role: string }>;
}

/** The instances of this app (the dev bundle, or the package) the account reaches. */
export async function listInstances(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  return client.listApps(filter);
}

export async function listOrgs(client: Pick<CalimeroClient, "me">): Promise<OrgRow[]> {
  const me = (await client.me()) as MeOrgs;
  return (me.orgs ?? [])
    .map((o) => ({ orgId: o.orgId, name: o.name, role: o.role }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.orgId.localeCompare(b.orgId));
}

export async function listWorkspaces(
  client: Pick<CalimeroClient, "listApps">,
  source: AppSource,
): Promise<WorkspaceRow[]> {
  return (await listInstances(client, source))
    .map((a) => ({ appId: a.appId, name: a.name, org: a.org, owner: a.owner }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/**
 * A new workspace: in `org` when given, else in a new org of the same name
 * (v1 made a namespace and a context in it). A new org gets this app's open
 * team (`createAppOrg`); the instance goes on the app's team, made first by an
 * owner or admin in an org whose other apps have teams (`orgInstanceOptions`),
 * or uses organization access in a legacy org. Answers the instance id and org.
 */
export async function createWorkspace(
  client: Pick<
    CalimeroClient,
    "createOrg" | "createApp" | "getOrg" | "setOrgMetadata" | "setCapabilities" | "scopeApps" | "session"
  >,
  source: AppSource,
  name: string,
  org: string | null,
  passkey: () => PasskeyProvider,
): Promise<{ appId: string; org: string }> {
  const orgId = org ?? (await createAppOrg(client, name, source, passkey, { mark: false })).orgId;
  const appId = await client.createApp(name, source, await orgInstanceOptions(client, orgId, source, passkey, PRODUCT_NAME));
  return { appId, org: orgId };
}

// ── members ──────────────────────────────────────────────────────────────────

/** The parts of `GET /orgs/{org}` the screens read. */
export interface OrgMembers {
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> the name they set for the org, where one is set. */
  names: Map<string, string>;
  /** Who has this app in the org, in org order: its app team's people, else the org's (no guest once it has app teams). */
  people: string[];
  /** The org keeps its apps apart and this one has its team: an invite gives Mero Forms only. */
  appOnly: boolean;
}

export async function readMembers(
  client: Pick<CalimeroClient, "getOrg">,
  org: string,
  source: AppSource | null = null,
): Promise<OrgMembers> {
  const o = (await client.getOrg(org)) as Record<string, unknown>;
  const pkg = sourcePackage(source);
  const members = (o.members ?? {}) as Record<string, string>;
  const meta = (o.memberMetadata ?? {}) as Record<string, unknown>;
  const names = new Map<string, string>();
  for (const [account, value] of Object.entries(meta)) {
    const name = (value as { name?: unknown } | null)?.name;
    if (typeof name === "string" && name.trim()) names.set(account, name.trim());
  }
  return {
    roles: new Map(Object.entries(members)),
    names,
    people: appPeople(o as AppOrgView, pkg),
    appOnly: isAppOnly(o as AppOrgView, pkg),
  };
}

/** Publishes the name `account` goes by across the org (org member metadata). */
export async function publishName(
  client: Pick<CalimeroClient, "setMemberMetadata">,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  await client.setMemberMetadata(org, account, { name });
}

// ── invitations ──────────────────────────────────────────────────────────────

/**
 * An invitation into `org` as a member, approved with the inviter's passkey
 * (412 step-up), naming this app's team (`appInvite`): `appOnly` when it gives
 * Mero Forms only (an org that keeps its apps apart). Org-wide in a legacy org.
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
 * The link that opens this frontend with `token` to redeem, landing in
 * `workspace`. It also names `org`: the token does not say which org it is for
 * until it is redeemed, and redeeming spends it, so the link carries the org
 * for the app to tell an existing member "you are already in" without
 * spending a use.
 *
 * The link stays under the served `/{version}/` root until every cluster's
 * served-host redirect keeps the query string (core's served-redirect fix).
 */
export function inviteLink(
  token: string,
  workspace: string,
  location: Pick<Location, "href"> = window.location,
  org?: string,
): string {
  const url = new URL(location.href);
  return sharedInviteLink(token, { org, extra: { workspace }, root: nodeBasename(url, "/"), origin: url.origin });
}

/** This app's pending invite (`@calimero-apps/connect`), with the workspace its link lands in. */
export const invites = createInviteStore("mero-forms", { keep: ["workspace"] });

/** The workspace (app instance) a pending invite's link lands in, when it names one. */
export function inviteWorkspace(invite: PendingInvite | null): string | null {
  return invite?.extra.workspace ?? null;
}

const LEGACY_PENDING = "mero-forms:pending-invite";

/**
 * Moves an invite an earlier build stored under its own key into the shared
 * store, so a link opened before the upgrade still joins after it.
 */
export function migrateLegacyInvite(store: KeyValueStorage | null = storage(), into: InviteStore = invites): void {
  try {
    const raw = store?.getItem(LEGACY_PENDING);
    if (!raw) return;
    store?.removeItem(LEGACY_PENDING);
    const old = JSON.parse(raw) as { token?: unknown; workspace?: unknown; org?: unknown };
    if (typeof old.token !== "string" || !old.token) return;
    into.put({
      token: old.token,
      org: typeof old.org === "string" && old.org ? old.org : null,
      team: null,
      doc: null,
      route: null,
      extra: typeof old.workspace === "string" && old.workspace ? { workspace: old.workspace } : {},
    });
  } catch {
    /* unreadable: nothing to move */
  }
}

function storage(): KeyValueStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}
