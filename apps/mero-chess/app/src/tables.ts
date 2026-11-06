import { CalimeroError, type AppInfo, type CalimeroClient, type PasskeyProvider } from "@calimero-network/mero-js";
import { describeError, targetKey, type AppSource, type KeyValueStorage, type Target } from "@calimero-apps/connect";

import { APP } from "./session";

/**
 * A table is an app instance: v1's context. Tables live in an organization
 * (v1's namespace, the "club"), whose members reach every table in it, so one
 * invitation lets an opponent into all of them.
 */

/** The tables the account reaches: of the dev bundle, or of the package. */
export async function listTables(client: Pick<CalimeroClient, "listApps">, source: AppSource): Promise<AppInfo[]> {
  const filter = typeof source === "string" ? { bundle: source } : { package: source.package };
  const apps = await client.listApps(filter);
  return [...apps].sort((a, b) => a.name.localeCompare(b.name) || a.appId.localeCompare(b.appId));
}

/**
 * A new table named `name`. In `org` when given (v1: another context in a
 * namespace you have), otherwise in a new organization of its own (v1's "New
 * table" made a namespace and a context in it). `now` is the creator's clock,
 * the table's `createdAt`.
 */
export async function createTable(
  client: Pick<CalimeroClient, "createApp" | "createOrg">,
  source: AppSource,
  name: string,
  org?: string,
  now: number = Date.now(),
): Promise<{ appId: string; org: string }> {
  const inOrg = org ?? (await client.createOrg(name));
  const appId = await client.createApp(name, source, {
    org: inOrg,
    initArgs: { title: name, now: String(Math.floor(now)) },
  });
  return { appId, org: inOrg };
}

/** An invitation into `org` as a member, approved with the inviter's passkey (412 step-up). */
export function inviteToken(
  client: Pick<CalimeroClient, "invite">,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.invite(org, "member", passkey);
}

/** The link that opens this frontend with `token` to redeem and `table` to open after. */
export function inviteLink(
  token: string,
  table: string,
  location: Pick<Location, "origin" | "pathname"> = window.location,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
  url.searchParams.set("table", table);
  return url.toString();
}

export interface PendingInvite {
  token: string;
  /** The table the link was made in: opened once the invitation is redeemed. */
  table: string | null;
}

const PENDING = `${APP}:pending-invite`;

/**
 * Takes `?invite=` (and `&table=`) off the address bar into storage, before
 * anything renders: a person opening a link is usually not signed in yet, and
 * the token must survive the sign-up. Redeemed (and dropped) once a session
 * exists.
 */
export function captureInvite(storage: KeyValueStorage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  try {
    storage.setItem(PENDING, JSON.stringify({ token, table: url.searchParams.get("table") }));
  } catch {
    return;
  }
  dropDeferral();
  url.searchParams.delete("invite");
  url.searchParams.delete("table");
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): PendingInvite | null {
  try {
    const raw = storage.getItem(PENDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingInvite>;
    return typeof parsed.token === "string"
      ? { token: parsed.token, table: typeof parsed.table === "string" ? parsed.table : null }
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
  dropDeferral();
}

const DEFERRED = `${APP}:invite-deferred`;

/**
 * "Not now" on the invitation: the ordinary landing page for the rest of this
 * tab, with the token KEPT, so signing in later still joins.
 */
export function deferInvite(storage: Pick<Storage, "setItem"> = sessionStorage): void {
  try {
    storage.setItem(DEFERRED, "1");
  } catch {
    /* the page still moves on for this render */
  }
}

export function inviteDeferred(storage: Pick<Storage, "getItem"> = sessionStorage): boolean {
  try {
    return storage.getItem(DEFERRED) === "1";
  } catch {
    return false;
  }
}

function dropDeferral(storage: Pick<Storage, "removeItem"> = sessionStorage): void {
  try {
    storage.removeItem(DEFERRED);
  } catch {
    /* nothing stored */
  }
}

/** What to say when a token is refused for good. */
export const SPENT_INVITE = "This invite was already used or has expired. Ask the person who invited you for a new link.";

/**
 * Whether the node refused the token for good (unknown, used, expired,
 * revoked) rather than failing to answer: a 4xx other than 401/429.
 */
export function inviteRefused(e: unknown): boolean {
  if (e instanceof CalimeroError) return e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;
  return /unknown invite|already used|expired|revoked/i.test(describeError(e));
}

/** The table last opened on this target by this account, remembered across loads. */
export function selectionKey(target: Target, accountId: string): string {
  return `${APP}:table:${targetKey(target)}:${accountId}`;
}
