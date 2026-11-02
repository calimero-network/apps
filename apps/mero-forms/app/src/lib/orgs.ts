import type { AppInfo, CalimeroClient, PasskeyProvider } from "@calimero-network/mero-js";
import type { AppSource, KeyValueStorage } from "@calimero-apps/connect";

/**
 * v1 → Calimero 1.0, for this app:
 *
 * | v1 | here |
 * |---|---|
 * | a workspace: a context of the app | an **app instance** (`createApp(name, source, { org })`) |
 * | the namespace it lives in | an **organization** (`createOrg`) |
 * | a namespace invitation link (deflate + base58) | an **org invite** token in `?invite=` (`invite` is a passkey step-up; `redeemInvite` after sign-in) |
 * | the name a person set for the namespace (`@calimero-apps/names`) | org **member metadata** `{ name }` |
 * | joining the context and waiting for it to sync | nothing: every member of the org reaches its instances |
 */

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
 * (v1 made a namespace and a context in it). Answers the instance id and org.
 */
export async function createWorkspace(
  client: Pick<CalimeroClient, "createOrg" | "createApp">,
  source: AppSource,
  name: string,
  org: string | null,
): Promise<{ appId: string; org: string }> {
  const orgId = org ?? (await client.createOrg(name));
  const appId = await client.createApp(name, source, { org: orgId });
  return { appId, org: orgId };
}

// ── members ──────────────────────────────────────────────────────────────────

/** The parts of `GET /orgs/{org}` the screens read. */
export interface OrgMembers {
  /** account -> `owner` | `admin` | `member` | `guest`. */
  roles: Map<string, string>;
  /** account -> the name they set for the org, where one is set. */
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
  return { roles: new Map(Object.entries(members)), names };
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

/** An invitation into `org` as a member, approved with the inviter's passkey (412 step-up). */
export function inviteToken(
  client: Pick<CalimeroClient, "invite">,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.invite(org, "member", passkey);
}

/** The link that opens this frontend with `token` to redeem, landing in `workspace`. */
export function inviteLink(
  token: string,
  workspace: string,
  location: Pick<Location, "origin" | "pathname"> = window.location,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
  url.searchParams.set("workspace", workspace);
  return url.toString();
}

export interface PendingInvite {
  token: string;
  /** The workspace the link lands in, when it names one. */
  workspace: string | null;
}

const PENDING = "mero-forms:pending-invite";

function storage(): KeyValueStorage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/**
 * Takes `?invite=` (and `&workspace=`) off the address bar into storage,
 * before anything renders: a person opening a link is usually not signed in
 * yet, and the token must survive the sign-up.
 */
export function captureInvite(store: KeyValueStorage | null = storage(), loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token || !store) return;
  const pending: PendingInvite = { token, workspace: url.searchParams.get("workspace") };
  try {
    store.setItem(PENDING, JSON.stringify(pending));
  } catch {
    return;
  }
  url.searchParams.delete("invite");
  url.searchParams.delete("workspace");
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(store: KeyValueStorage | null = storage()): PendingInvite | null {
  try {
    const raw = store?.getItem(PENDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingInvite>;
    return typeof parsed.token === "string" && parsed.token
      ? { token: parsed.token, workspace: typeof parsed.workspace === "string" ? parsed.workspace : null }
      : null;
  } catch {
    return null;
  }
}

export function dropInvite(store: KeyValueStorage | null = storage()): void {
  try {
    store?.removeItem(PENDING);
  } catch {
    /* nothing stored */
  }
}

/** The org an invitation redeemed into, from whichever field the node named it. */
export function joinedOrg(redeemed: Record<string, unknown>): string | null {
  for (const k of ["org", "orgId"]) {
    const v = redeemed[k];
    if (typeof v === "string" && v) return v;
  }
  return null;
}
