import { ORG_CAPABILITIES, type AppInfo, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import {
  SPENT_INVITE_COPY,
  appInvite,
  appPeople,
  createAppOrg,
  createInviteStore,
  isAppOnly,
  leaveApp,
  leaveOrg,
  orgInstanceOptions,
  removeFromApp,
  orgsWithApp,
  sourcePackage,
  type AppInviteToken,
  type AppOrgView,
  type LeftApp,
  inviteLink as sharedInviteLink,
  isSpentInvite,
  type AppSource,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite as SharedPendingInvite,
} from "@calimero-apps/connect";
import { setOrgName } from "@calimero-apps/names";
import { nodeBasename } from "@calimero-apps/node-served";

import { APP_NAME } from "./config";

/** The app's name where an owner or admin is told who may add it, and in invite notes. */
export const PRODUCT_NAME = "Mero Updates";

/** Where no passkey was handed over: asked for only to add Mero Updates' team to an org. */
const noPasskey = (): PasskeyProvider => {
  throw new Error(`A passkey is needed to add ${PRODUCT_NAME} to this organization.`);
};

/**
 * v1 → Calimero 1.0, for this app:
 *
 * | v1 | here |
 * |---|---|
 * | a company: a namespace of the app | an **organization** (`createOrg`) |
 * | an audience: an open subgroup + its context | an **app instance** in the org (`createApp(name, source, { org })`) |
 * | joining an audience (subgroup inheritance, context join, identity wait) | nothing: every member of the org reaches every instance in it |
 * | a namespace / audience invitation (signed payload, deflate + base58 link) | an **org invite** token in `?invite=` (`invite` is a passkey step-up; `redeemInvite` after sign-in), plus `&audience=` to land in one audience |
 * | the name a member set for the whole company | org **member metadata** `{ name }` |
 */

/** A company this account is in. */
export interface NamespaceRow {
  /** The org id. Named for what the screens called it. */
  namespaceId: string;
  name: string;
  role: string;
  audienceCount: number;
  memberCount: number;
}

/** An audience: an instance of this app in the company's org. */
export interface AudienceRow {
  /** The app instance id (v1's context id). */
  contextId: string;
  name: string;
  /** The account that created it (the instance's owner, its first admin). */
  owner: string;
}

interface MeOrgs {
  orgs?: Array<{ orgId: string; name: string; role: string }>;
}

function filterOf(source: AppSource): { bundle: string } | { package: string } {
  return typeof source === "string" ? { bundle: source } : { package: source.package };
}

/** Every instance of this app (the dev bundle, or the package) the account can see. */
async function allAudiences(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<AppInfo[]> {
  return client.listApps(filterOf(source));
}

/**
 * The companies: the orgs this account is in that hold an audience or were
 * made for Mero Updates. An org made for another app is offered under
 * "Connect to an existing organization" instead.
 */
export async function listCompanies(
  client: Pick<CalimeroClient, "me" | "listApps" | "getOrg">,
  source: AppSource,
): Promise<NamespaceRow[]> {
  const orgs = await orgsWithApp(client, source, { marked: true });
  const apps = await allAudiences(client, source);
  const rows = await Promise.all(
    orgs.map(async (o) => {
      const org = await client.getOrg(o.orgId).catch(() => null);
      return {
        namespaceId: o.orgId,
        name: o.name,
        role: o.role,
        audienceCount: apps.filter((a) => a.org === o.orgId).length,
        // Who has Mero Updates there: its app team, else the org.
        memberCount: org ? appPeople(org as AppOrgView, sourcePackage(source)).length : 0,
      };
    }),
  );
  return rows.sort((a, b) => a.name.localeCompare(b.name) || a.namespaceId.localeCompare(b.namespaceId));
}

export async function listAudiences(
  client: Pick<CalimeroClient, "listApps">,
  source: AppSource,
  org: string,
): Promise<AudienceRow[]> {
  return (await allAudiences(client, source))
    .filter((a) => a.org === org)
    .map((a) => ({ contextId: a.appId, name: a.name, owner: a.owner }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.contextId.localeCompare(b.contextId));
}

/**
 * What a member may do unless an admin sets otherwise, as v1 set it at
 * creation: start an audience, invite people, and the node's default of
 * joining open teams. Governing the company (roles) stays with admins.
 */
export const MEMBER_DEFAULTS =
  ORG_CAPABILITIES.CREATE_APP | ORG_CAPABILITIES.INVITE_MEMBERS | ORG_CAPABILITIES.JOIN_OPEN_TEAMS;

export interface CreatedCompany {
  namespaceId: string;
  /** Set when the org exists but its member defaults could not be set (a cancelled passkey). */
  warning: string | null;
}

/** A new company: an org whose members may start audiences and invite (a passkey step-up). */
export async function createCompany(
  client: Pick<CalimeroClient, "createOrg" | "setCapabilities" | "getOrg" | "setOrgMetadata" | "scopeApps">,
  name: string,
  passkey: () => PasskeyProvider,
  source?: AppSource,
): Promise<CreatedCompany> {
  // The org, marked so it is listed as a company before it holds an audience,
  // its member defaults, and Mero Updates' own team (core#4890), open
  // (declined, or an older node: a legacy org).
  const made = await createAppOrg(client, name, source, passkey, { capabilities: MEMBER_DEFAULTS });
  return {
    namespaceId: made.orgId,
    warning: made.capabilitiesError
      ? "The company was created, but people you invite will not be able to start audiences or invite others until an admin approves the defaults."
      : null,
  };
}

/**
 * Leaves the company (`leaveApp`, a passkey step-up). In an org that keeps
 * its apps apart that is Mero Updates only, with `lastApp` set when it was
 * the caller's last app there (offer {@link leaveCompanyOrg}); elsewhere the
 * organization, as before.
 */
export function leaveCompany(
  client: Pick<CalimeroClient, "getOrg" | "listAppTeams" | "removeTeamMember" | "removeMember" | "session">,
  org: string,
  source: AppSource | null,
  passkey: () => PasskeyProvider,
  self?: string,
): Promise<LeftApp> {
  return leaveApp(client, org, source, passkey, self ? { self } : {});
}

/** Leaves the organization altogether, every app in it. A passkey step-up. */
export function leaveCompanyOrg(
  client: Pick<CalimeroClient, "removeMember" | "session">,
  org: string,
  passkey: () => PasskeyProvider,
  self?: string,
): Promise<void> {
  return leaveOrg(client, org, passkey, self);
}

/**
 * Takes `account` out of the company (`removeFromApp`, a passkey step-up; its
 * owners and admins). In an org that keeps its apps apart that is Mero
 * Updates only (its team), never the organization; elsewhere the org, as
 * before. Answers which it was.
 */
export function removeFromCompany(
  client: Pick<CalimeroClient, "getOrg" | "removeTeamMember" | "removeMember">,
  org: string,
  source: AppSource | null,
  account: string,
  passkey: () => PasskeyProvider,
): Promise<"app" | "org"> {
  return removeFromApp(client, org, source, account, passkey);
}

/** The audience created in an org the account connects to Mero Updates ("Connect to an existing organization"). */
export const CONNECTED_AUDIENCE_NAME = "Everyone";

/**
 * A new audience in `org`, on Mero Updates' team (`orgInstanceOptions`: made
 * first, by an owner or admin, in an org whose other apps have teams;
 * organization access in a legacy org); answers the instance id. Its creator
 * is its first admin.
 */
export async function createAudience(
  client: Pick<CalimeroClient, "createApp" | "getOrg" | "scopeApps" | "session">,
  source: AppSource,
  org: string,
  name: string,
  passkey: () => PasskeyProvider = noPasskey,
): Promise<string> {
  return client.createApp(name, source, await orgInstanceOptions(client, org, source, passkey, PRODUCT_NAME));
}

/** The company's name, member roles and member names. */
export interface CompanyInfo {
  name: string;
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> the name they set for the whole company. */
  names: Map<string, string>;
  /** Who has Mero Updates in the company: its app team, else the org (no guest once it has app teams). */
  people: string[];
  /** The org keeps its apps apart and Mero Updates has its team: invites, Remove and Leave are its only. */
  appOnly: boolean;
}

export async function readCompany(
  client: Pick<CalimeroClient, "getOrg">,
  org: string,
  source: AppSource | null = null,
): Promise<CompanyInfo> {
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
    name: typeof o.name === "string" ? o.name : "",
    roles: new Map(Object.entries(members)),
    names,
    people: appPeople(o as AppOrgView, pkg),
    appOnly: isAppOnly(o as AppOrgView, pkg),
  };
}

/**
 * Show `account` as `name` across the company (org member metadata, merged
 * with what the record holds). Throws when the node refuses.
 */
export function setCompanyName(
  client: Pick<CalimeroClient, "getOrg" | "setMemberMetadata">,
  org: string,
  account: string,
  name: string,
): Promise<void> {
  return setOrgName(client, org, account, name);
}

/** Owners and admins govern a company (delete it, delete any audience in it). */
export const isAdminRole = (role: string | undefined) => role === "owner" || role === "admin";

// ── invitations ──────────────────────────────────────────────────────────────

/**
 * An invitation into `org` as a member, approved with the inviter's passkey
 * (412 step-up), naming Mero Updates' team (`appInvite`): `appOnly` when it
 * gives Mero Updates only (an org that keeps its apps apart). Org-wide in a
 * legacy org.
 */
export function mintInvite(
  client: Pick<CalimeroClient, "listAppTeams" | "invite">,
  org: string,
  passkey: PasskeyProvider,
  source: AppSource | null = null,
): Promise<AppInviteToken> {
  return appInvite(client, org, source, passkey);
}

/**
 * The link that opens this frontend with `token` to redeem, and optionally an
 * audience to land in. `org` names the company the token admits to, so someone
 * already in it (the inviter opening their own link, say) is told so instead
 * of spending the token's single use.
 *
 * The link stays under the served `/{version}/` root until every cluster's
 * served-host redirect keeps the query string (core's served-redirect fix).
 */
export function inviteLink(
  token: string,
  audience: string | null = null,
  org: string | null = null,
  location: Pick<Location, "href"> = window.location,
): string {
  const url = new URL(location.href);
  return sharedInviteLink(token, { org, extra: { audience }, root: nodeBasename(url, "/"), origin: url.origin });
}

export interface PendingInvite {
  token: string;
  audience: string | null;
  /** The company (org) the token admits to, when the link names it. */
  org: string | null;
}

/** This app's pending invite (`@calimero-apps/connect`), with the audience its link lands in. */
export const invites = createInviteStore(APP_NAME, { keep: ["audience"] });

const LEGACY_PENDING = `${APP_NAME}:pending-invite`;

/**
 * Takes `?invite=` (and `&audience=`, `&org=`) off the address bar into the
 * store, before anything renders: a person opening a link is usually not
 * signed in yet, and the token must survive the sign-up. An invite an earlier
 * build stored under its own key moves over first.
 */
export function captureInvite(loc: Pick<Location, "href"> = window.location): void {
  migrateLegacyInvite();
  invites.capture(loc, { basename: nodeBasename(new URL(loc.href), "/") });
}

/** Moves an invite an earlier build stored under its own key into the shared store. */
export function migrateLegacyInvite(storage: KeyValueStorage = localStorage, into: InviteStore = invites): void {
  try {
    const raw = storage.getItem(LEGACY_PENDING);
    if (!raw) return;
    storage.removeItem(LEGACY_PENDING);
    const old = JSON.parse(raw) as Partial<PendingInvite>;
    if (typeof old.token !== "string" || !old.token) return;
    into.put({
      token: old.token,
      org: typeof old.org === "string" && old.org ? old.org : null,
      team: null,
      doc: null,
      route: null,
      extra: typeof old.audience === "string" && old.audience ? { audience: old.audience } : {},
    });
  } catch {
    /* unreadable: nothing to move */
  }
}

/** The app's view of a pending invite. */
export function updatesInvite(pending: SharedPendingInvite | null): PendingInvite | null {
  return pending ? { token: pending.token, audience: pending.extra.audience ?? null, org: pending.org } : null;
}

/**
 * The invite a sign-up from this page joined with, kept after the store
 * dropped it, for `InvitationPrompt` to open what the link named (nothing is
 * redeemed again).
 */
let joinedAtSignUp: PendingInvite | null = null;

/** `onJoinedAtSignUp` for `usePasskeySession`. */
export function noteJoinedAtSignUp(
  joined: { invite: string; org: string | null },
  pending: SharedPendingInvite | null,
): void {
  const invite = updatesInvite(pending);
  joinedAtSignUp = invite
    ? { ...invite, org: joined.org ?? invite.org }
    : { token: joined.invite, audience: null, org: joined.org };
}

/** The pending invite, or the one a sign-up just joined with. */
export function pendingInvite(): PendingInvite | null {
  return updatesInvite(invites.pending()) ?? joinedAtSignUp;
}

export function dropInvite(): void {
  invites.drop();
  joinedAtSignUp = null;
}

/** The org an invitation redeemed into, from whichever field the node named it. */
export function joinedOrg(redeemed: Record<string, unknown>): string | null {
  for (const key of ["org", "orgId"]) {
    const v = redeemed[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}

/** What to say when the node refused an invitation: it is unknown, already used, expired or revoked. */
export const INVITE_REFUSED = SPENT_INVITE_COPY;

/**
 * True when `e` is the node refusing the invitation itself (see
 * `INVITE_REFUSED`): the caller drops the token. A lapsed session, a rate
 * limit or the cluster unreachable keeps it.
 */
export function inviteRefused(e: unknown): boolean {
  return isSpentInvite(e);
}

/**
 * Whether this account is already in the company an invitation admits to:
 * `true` or `false` when the link names its org, `null` when it cannot be told
 * (an older link). Redeeming as an existing member spends the token's single
 * use, which then leaves the person it was meant for unable to join.
 */
export async function alreadyMember(
  client: Pick<CalimeroClient, "me">,
  invite: PendingInvite,
): Promise<boolean | null> {
  if (!invite.org) return null;
  try {
    const me = (await client.me()) as MeOrgs;
    return (me.orgs ?? []).some((o) => o.orgId === invite.org);
  } catch {
    return null;
  }
}
