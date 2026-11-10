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

import { APP_NAME } from "../config";

/**
 * v1 → Calimero 1.0, for this app:
 *
 * | v1 | here |
 * |---|---|
 * | a space: a namespace of the app | an **organization** (`createOrg`) |
 * | a forum: a subgroup + the context bound to it | an **app instance** in the org (`createApp(name, source, { org })`) |
 * | the forum's name: the subgroup alias | the instance's `name` |
 * | a namespace (or forum) invitation: a signed payload in a deflate+base58 link | an **org invite** token in `?invite=` (`invite` is a passkey step-up; `redeemInvite` after sign-in); a forum link also carries `&forum=<app id>` |
 * | the name a person set for the whole space: namespace member metadata | org **member metadata** `{ name }` |
 * | joining a forum context, waiting for it to sync | nothing: every member of the org reaches its instances, and nothing has to replicate first |
 */

/** A space this account is in. Field names are what the screens called them. */
export interface NamespaceRow {
  /** The org id. */
  namespaceId: string;
  name: string;
  /** `owner` | `admin` | `member` | `guest`. */
  role: string;
  forumCount: number;
  memberCount: number;
}

/** A forum: an instance of this app in the space's org. */
export interface ForumRow {
  /** The app instance id. */
  forumId: string;
  /** The same id: v1 told the subgroup and its context apart. */
  contextId: string;
  name: string;
  /** The account that created the instance: it (or a space admin) may delete it. */
  owner: string;
}

/** What `/me` answers about orgs. */
interface MeOrgs {
  orgs?: Array<{ orgId: string; name: string; role: string }>;
}

/** The instances of this app (the dev bundle, or the package) the account reaches. */
export async function listInstances(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  return client.listApps(filter);
}

function byName<T extends { name: string }>(key: (row: T) => string) {
  return (a: T, b: T) => a.name.localeCompare(b.name) || key(a).localeCompare(key(b));
}

/** Every space this account is in, with its forum and member counts. */
export async function listSpaces(
  client: Pick<CalimeroClient, "me" | "listApps" | "getOrg">,
  source: AppSource,
): Promise<NamespaceRow[]> {
  const [me, apps] = await Promise.all([client.me() as Promise<MeOrgs>, listInstances(client, source)]);
  const rows = await Promise.all(
    (me.orgs ?? []).map(async (o) => {
      const members = await readMembers(client, o.orgId).catch(() => null);
      return {
        namespaceId: o.orgId,
        name: o.name,
        role: o.role,
        forumCount: apps.filter((a) => a.org === o.orgId).length,
        memberCount: members ? members.roles.size : 0,
      };
    }),
  );
  return rows.sort(byName((r) => r.namespaceId));
}

/** The forums in `org`, by name. */
export async function listForums(
  client: Pick<CalimeroClient, "listApps">,
  source: AppSource,
  org: string,
): Promise<ForumRow[]> {
  return (await listInstances(client, source))
    .filter((a) => a.org === org)
    .map((a) => ({ forumId: a.appId, contextId: a.appId, name: a.name, owner: a.owner }))
    .sort(byName((r) => r.forumId));
}

/**
 * What a member may do unless an admin sets otherwise, as v1 set it on a new
 * namespace: create forums and invite people (and join open teams, the node's
 * own default).
 */
export const MEMBER_DEFAULTS =
  ORG_CAPABILITIES.CREATE_APP | ORG_CAPABILITIES.INVITE_MEMBERS | ORG_CAPABILITIES.JOIN_OPEN_TEAMS;

/**
 * A new space: an org whose members may create forums and invite. Setting the
 * defaults is a passkey step-up; refused, the org stays (only its owner and
 * admins can then create forums and invite).
 */
export async function createSpace(
  client: Pick<CalimeroClient, "createOrg" | "setCapabilities">,
  name: string,
  passkey: () => PasskeyProvider,
  onStatus: (m: string) => void = () => {},
): Promise<{ namespaceId: string; warning: string | null }> {
  onStatus("Creating the space…");
  const namespaceId = await client.createOrg(name);
  onStatus("Letting members create forums and invite…");
  try {
    await client.setCapabilities(namespaceId, MEMBER_DEFAULTS, passkey());
    return { namespaceId, warning: null };
  } catch {
    return {
      namespaceId,
      warning: "The space was created, but people you invite will not be able to create forums or invite others.",
    };
  }
}

/** Deletes the org and, with it, every forum in it. A passkey step-up. */
export async function deleteSpace(
  client: Pick<CalimeroClient, "deleteOrg">,
  org: string,
  passkey: () => PasskeyProvider,
): Promise<void> {
  await client.deleteOrg(org, passkey());
}

/** Leaves the org (removes the caller). A passkey step-up. */
export async function leaveSpace(
  client: Pick<CalimeroClient, "removeMember">,
  org: string,
  self: string,
  passkey: () => PasskeyProvider,
): Promise<void> {
  await client.removeMember(org, self, passkey());
}

/** A new forum in `org`. Answers its instance id. */
export function createForum(
  client: Pick<CalimeroClient, "createApp">,
  source: AppSource,
  org: string,
  name: string,
): Promise<string> {
  return client.createApp(name, source, { org });
}

/** Deletes the forum instance, its posts and comments with it. */
export function deleteForum(client: Pick<CalimeroClient, "deleteApp">, forumId: string): Promise<void> {
  return client.deleteApp(forumId);
}

// ── members ──────────────────────────────────────────────────────────────────

/** The parts of `GET /orgs/{org}` the screens read. */
export interface OrgMembers {
  name: string;
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> the name they set for the space, where one is set. */
  names: Map<string, string>;
}

export async function readMembers(client: Pick<CalimeroClient, "getOrg">, org: string): Promise<OrgMembers> {
  const o = (await client.getOrg(org)) as Record<string, unknown>;
  const members = (o.members ?? {}) as Record<string, string>;
  const meta = (o.memberMetadata ?? {}) as Record<string, unknown>;
  const names = new Map<string, string>();
  for (const [account, value] of Object.entries(meta)) {
    const name = (value as { name?: unknown } | null)?.name;
    if (typeof name === "string" && name.trim()) names.set(account, name.trim());
  }
  return { name: typeof o.name === "string" ? o.name : "", roles: new Map(Object.entries(members)), names };
}

/** The caller's role in `org` (`/me`), or null when not in it. */
export async function roleIn(client: Pick<CalimeroClient, "me">, org: string): Promise<string | null> {
  const me = (await client.me()) as MeOrgs;
  return me.orgs?.find((o) => o.orgId === org)?.role ?? null;
}

/** The caller may delete the space (owner or admin), else only leave it. */
export function isSpaceAdmin(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

/** Publishes the name `account` goes by across the space (org member metadata). */
export async function publishSpaceName(
  client: Pick<CalimeroClient, "setMemberMetadata">,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  await client.setMemberMetadata(org, account, { name });
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
 * The link that opens this frontend with `token` to redeem; with `forum`, the
 * joiner lands in that forum instead of on the space's forum list.
 *
 * The link stays under the served `/{version}/` root until every cluster's
 * served-host redirect keeps the query string (core's served-redirect fix).
 */
export function inviteLink(
  token: string,
  forum?: string,
  location: Pick<Location, "href"> = window.location,
  org?: string,
): string {
  const url = new URL(location.href);
  // The token does not say which space it is for until it is redeemed, and
  // redeeming spends it: the link names the space so the app can tell an
  // existing member "you are already in" without spending a use.
  return sharedInviteLink(token, { org, extra: { forum }, root: nodeBasename(url, "/"), origin: url.origin });
}

/** This app's pending invite (`@calimero-apps/connect`), with the forum its link lands in. */
export const invites = createInviteStore(APP_NAME, { keep: ["forum"] });

/** The forum a pending invite's link lands in, when it names one. */
export function inviteForum(invite: PendingInvite | null): string | null {
  return invite?.extra.forum ?? null;
}

const LEGACY_PENDING = `${APP_NAME}:pending-invite`;

/**
 * Moves an invite an earlier build stored under its own key into the shared
 * store, so a link opened before the upgrade still joins after it.
 */
export function migrateLegacyInvite(storage: KeyValueStorage = localStorage, into: InviteStore = invites): void {
  try {
    const raw = storage.getItem(LEGACY_PENDING);
    if (!raw) return;
    storage.removeItem(LEGACY_PENDING);
    const old = JSON.parse(raw) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v ? v : null);
    const token = str(old.token);
    if (!token) return;
    const forum = str(old.forum);
    into.put({ token, org: str(old.org), team: null, doc: null, route: str(old.route), extra: forum ? { forum } : {} });
  } catch {
    /* unreadable: nothing to move */
  }
}
