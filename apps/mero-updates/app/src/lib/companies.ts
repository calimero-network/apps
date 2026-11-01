import { ORG_CAPABILITIES, type AppInfo, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource, KeyValueStorage } from "@calimero-apps/connect";

import { APP_NAME } from "./config";

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

export async function listCompanies(
  client: Pick<CalimeroClient, "me" | "listApps" | "getOrg">,
  source: AppSource,
): Promise<NamespaceRow[]> {
  const me = (await client.me()) as MeOrgs;
  const apps = await allAudiences(client, source);
  const rows = await Promise.all(
    (me.orgs ?? []).map(async (o) => {
      const org = await client.getOrg(o.orgId).catch(() => null);
      const members = (org?.members ?? {}) as Record<string, string>;
      return {
        namespaceId: o.orgId,
        name: o.name,
        role: o.role,
        audienceCount: apps.filter((a) => a.org === o.orgId).length,
        memberCount: Object.keys(members).length,
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
  client: Pick<CalimeroClient, "createOrg" | "setCapabilities">,
  name: string,
  passkey: () => PasskeyProvider,
): Promise<CreatedCompany> {
  const namespaceId = await client.createOrg(name);
  try {
    await client.setCapabilities(namespaceId, MEMBER_DEFAULTS, passkey());
    return { namespaceId, warning: null };
  } catch {
    return {
      namespaceId,
      warning:
        "The company was created, but people you invite will not be able to start audiences or invite others until an admin approves the defaults.",
    };
  }
}

/** A new audience in `org`; answers the instance id. Its creator is its first admin. */
export function createAudience(
  client: Pick<CalimeroClient, "createApp">,
  source: AppSource,
  org: string,
  name: string,
): Promise<string> {
  return client.createApp(name, source, { org });
}

/** The company's name, member roles and member names. */
export interface CompanyInfo {
  name: string;
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> the name they set for the whole company. */
  names: Map<string, string>;
}

export async function readCompany(client: Pick<CalimeroClient, "getOrg">, org: string): Promise<CompanyInfo> {
  const o = (await client.getOrg(org)) as Record<string, unknown>;
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

/** Owners and admins govern a company (delete it, delete any audience in it). */
export const isAdminRole = (role: string | undefined) => role === "owner" || role === "admin";

// ── invitations ──────────────────────────────────────────────────────────────

/** An invitation into `org` as a member, approved with the inviter's passkey (412 step-up). */
export function mintInvite(
  client: Pick<CalimeroClient, "invite">,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.invite(org, "member", passkey);
}

/** The link that opens this frontend with `token` to redeem, and optionally an audience to land in. */
export function inviteLink(
  token: string,
  audience: string | null = null,
  location: Pick<Location, "origin" | "pathname"> = window.location,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
  if (audience) url.searchParams.set("audience", audience);
  return url.toString();
}

export interface PendingInvite {
  token: string;
  audience: string | null;
}

const PENDING = `${APP_NAME}:pending-invite`;

/**
 * Takes `?invite=` (and `&audience=`) off the address bar into storage, before
 * anything renders: a person opening a link is usually not signed in yet, and
 * the token must survive the sign-up. Redeemed (and dropped) once a session exists.
 */
export function captureInvite(storage: KeyValueStorage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  try {
    storage.setItem(PENDING, JSON.stringify({ token, audience: url.searchParams.get("audience") }));
  } catch {
    return;
  }
  url.searchParams.delete("invite");
  url.searchParams.delete("audience");
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): PendingInvite | null {
  try {
    const raw = storage.getItem(PENDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingInvite>;
    return typeof parsed.token === "string" && parsed.token
      ? { token: parsed.token, audience: typeof parsed.audience === "string" ? parsed.audience : null }
      : null;
  } catch {
    return null;
  }
}

export function dropInvite(storage: KeyValueStorage = localStorage): void {
  try {
    storage.removeItem(PENDING);
  } catch {
    /* nothing stored */
  }
}

/** The org an invitation redeemed into, from whichever field the node named it. */
export function joinedOrg(redeemed: Record<string, unknown>): string | null {
  for (const key of ["org", "orgId"]) {
    const v = redeemed[key];
    if (typeof v === "string" && v) return v;
  }
  return null;
}
