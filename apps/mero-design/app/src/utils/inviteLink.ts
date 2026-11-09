import {
  createInviteStore,
  describeRedeemFailure,
  inviteLink as sharedInviteLink,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
} from "@calimero-apps/connect";
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
 *
 * The link stays under the served `/{version}/` root until every cluster's
 * served-host redirect keeps the query string (core's served-redirect fix).
 */
export function inviteLink(
  token: string,
  location: Pick<Location, "origin"> = window.location,
  base: string = nodeBasename(),
  org?: string | null,
): string {
  return sharedInviteLink(token, { org, root: base, origin: location.origin });
}

/** This app's pending invite (`@calimero-apps/connect`), captured in `main.tsx` before React mounts. */
export const invites = createInviteStore(APP_NAME);

/**
 * Takes `?invite=` (and the team and route it names) off the address bar into
 * the store, before anything renders: a person opening a link is usually not
 * signed in yet, and the token must survive the passkey sign-up. A new link
 * also undoes an earlier "Not now".
 */
export function captureInvite(loc: Pick<Location, "href"> = window.location): void {
  migrateLegacyInvite();
  if (invites.capture(loc, { basename: nodeBasename() })) dropDeferral();
}

/** The landing page's own paths: a link to one of them names no destination. */
const FRONT_DOOR = new Set(["/", "/docs", "/preview", "/login"]);

/**
 * Where joining goes: the route the link was opened on, unless that was the
 * front door; else the team's boards (`org`, once known), else the teams.
 */
export function inviteDestination(invite: Pick<PendingInvite, "route"> | null, org: string | null): string {
  const route = invite?.route ?? null;
  if (route && !FRONT_DOOR.has(route.replace(/\/+$/, "") || "/")) return route;
  return org ? `/teams/${org}/projects` : "/teams";
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
    const old = JSON.parse(raw) as { token?: unknown; org?: unknown; returnTo?: unknown };
    if (typeof old.token !== "string" || !old.token) return;
    const returnTo = typeof old.returnTo === "string" && old.returnTo.startsWith("/") ? old.returnTo : null;
    into.put({
      token: old.token,
      org: typeof old.org === "string" && old.org ? old.org : null,
      team: null,
      doc: null,
      // The old record kept the route's own query; the store keeps the path.
      route: returnTo ? returnTo.split("?")[0] : null,
      extra: {},
    });
  } catch {
    /* unreadable: nothing to move */
  }
}

/**
 * Set when a sign-up joined with the page's invite, before the session is
 * signed in: the team it joined and where the link pointed. The invitation
 * prompt (inside the router, which the session is not) takes it once signed
 * in and opens that; until then the front door does not redirect on its own.
 */
let joinedAtSignUp: { org: string | null; invite: PendingInvite | null } | null = null;

/** `onJoinedAtSignUp` for `usePasskeySession`: remember what to open. */
export function noteJoinedAtSignUp({ org }: { org: string | null }, pending: PendingInvite | null): void {
  joinedAtSignUp = { org: org ?? pending?.org ?? null, invite: pending };
}

/** Whether a sign-up just joined with the invite and its destination is still to open. */
export function joinedAtSignUpPending(): boolean {
  return joinedAtSignUp !== null;
}

/** Where a sign-up that just joined with the invite goes, once; `null` when none did. */
export function takeJoinedAtSignUp(): string | null {
  const joined = joinedAtSignUp;
  joinedAtSignUp = null;
  return joined ? inviteDestination(joined.invite, joined.org) : null;
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

/**
 * The plain sentence for a failed redemption: a spent invite plainly, anything
 * else (a lapsed session, a rate limit, the cluster unreachable) as worth
 * another try, the token kept.
 */
export function inviteFailure(e: unknown): string {
  return describeRedeemFailure(e);
}
