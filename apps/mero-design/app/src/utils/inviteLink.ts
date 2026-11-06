import { CalimeroError } from "@calimero-network/mero-js";
import { describeError, type KeyValueStorage } from "@calimero-apps/connect";
import { APP_NAME } from "../config";
import { nodeBasename } from "./servedByNode";

/**
 * Team invitations on Calimero 1.0: an **org invite** token (minted with the
 * inviter's passkey, `client.invite`) carried in `?invite=` on a link to this
 * frontend, redeemed (`client.redeemInvite`) once the person is signed in and
 * says yes. Replaces v1's signed namespace invitation in a deflate+base58
 * link, and its desktop deep link.
 */

/**
 * The link that opens this frontend with `token` to redeem.
 *
 * `org` names the team the token joins. The token itself does not say, and
 * without it the app cannot tell an invitation into a team the visitor is
 * already in: accepting that spends the link's one use on nobody.
 */
export function inviteLink(
  token: string,
  location: Pick<Location, "origin"> = window.location,
  base: string = nodeBasename(),
  org?: string | null,
): string {
  const url = new URL(base, location.origin);
  url.searchParams.set("invite", token);
  if (org) url.searchParams.set("org", org);
  return url.toString();
}

export interface PendingInvite {
  token: string;
  /** The team the link names (`&org=`), when it names one. */
  org?: string | null;
  /**
   * The route the link opened, under the router basename, when it was not the
   * front door: where joining goes, so a deep link survives the sign-in.
   */
  returnTo?: string | null;
}

/** The landing page's own paths: a link to one of them names no destination. */
const FRONT_DOOR = new Set(["/", "/docs", "/preview", "/login"]);

/** `pathname` relative to the router basename, or null for the front door. */
export function routeOf(pathname: string, base: string = nodeBasename()): string | null {
  const root = base.endsWith("/") ? base.slice(0, -1) : base;
  const rest = root && pathname.startsWith(root) ? pathname.slice(root.length) || "/" : pathname;
  const route = rest.startsWith("/") ? rest : `/${rest}`;
  return FRONT_DOOR.has(route.replace(/\/+$/, "") || "/") ? null : route;
}

const PENDING = `${APP_NAME}:pending-invite`;

/**
 * Takes `?invite=` off the address bar into storage, before anything renders:
 * a person opening a link is usually not signed in yet, and the token must
 * survive the passkey sign-up. Redeemed (and dropped) once a session exists
 * and the person says yes.
 */
export function captureInvite(storage: KeyValueStorage = localStorage, loc: Location = window.location): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  const org = url.searchParams.get("org");
  url.searchParams.delete("invite");
  url.searchParams.delete("org");
  const query = url.searchParams.toString();
  const returnTo = routeOf(url.pathname);
  try {
    storage.setItem(
      PENDING,
      JSON.stringify({
        token,
        org: org || null,
        returnTo: returnTo ? `${returnTo}${query ? `?${query}` : ""}` : null,
      } satisfies PendingInvite),
    );
  } catch {
    return;
  }
  dropDeferral();
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: KeyValueStorage = localStorage): PendingInvite | null {
  try {
    const raw = storage.getItem(PENDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingInvite>;
    if (typeof parsed.token !== "string" || !parsed.token) return null;
    return {
      token: parsed.token,
      org: typeof parsed.org === "string" && parsed.org ? parsed.org : null,
      returnTo: typeof parsed.returnTo === "string" && parsed.returnTo.startsWith("/") ? parsed.returnTo : null,
    };
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

const DEFERRED = `${APP_NAME}:invite-deferred`;

/**
 * "Not now" on the invitation page: show the ordinary landing page for the
 * rest of this tab, and KEEP the token, so signing in later still offers it.
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
 * revoked) rather than failing to answer: a 4xx, or a message that says so.
 */
export function inviteRefused(e: unknown): boolean {
  // 401 (the session lapsed) and 429 (slow down) say nothing about the token.
  if (e instanceof CalimeroError) return e.status >= 400 && e.status < 500 && e.status !== 401 && e.status !== 429;
  return /unknown invite|already used|expired|revoked|not found/i.test(describeError(e));
}

/** The plain sentence for a failed redemption. */
export function inviteFailure(e: unknown): string {
  return inviteRefused(e) ? SPENT_INVITE : `The invitation could not be accepted: ${describeError(e)}`;
}
