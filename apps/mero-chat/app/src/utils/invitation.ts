/**
 * Workspace invitations on Calimero 1.0: an org invite token.
 *
 * The inviter mints the token with a passkey step-up
 * (`GroupApiDataSource.createInvitation`); the link opens this frontend with
 * `?invite=<token>`. The person opening it is usually not signed in yet, so
 * `captureInvite` moves the token from the address bar into storage before
 * anything renders, and `InvitationPrompt` offers it once a session exists.
 *
 * v1 put a signed namespace invitation, deflated and base58-encoded, in a
 * `links.calimero.network` link; those links name a v1 namespace and are not
 * read any more.
 */

/** Where a captured, not yet redeemed, invitation waits. */
export const INVITATION_STORAGE_KEY = "mero-chat:pending-invite";

/** The registry package (v1's links-page slug). */
export const APP_SLUG = "com.calimero.chat";

/** The workspace a captured invitation's link named (`&org=`). */
export const INVITATION_ORG_STORAGE_KEY = "mero-chat:pending-invite-org";

/** "Not now" on the invitation page, for the rest of this tab. */
const DEFERRED_KEY = "mero-chat:invite-deferred";

/**
 * The link that opens this frontend with `token` to redeem.
 *
 * `org` names the workspace the token joins. The token itself does not say,
 * and without it the app cannot tell an invitation into a workspace the
 * visitor is already in: accepting that spends the link's single use on
 * nobody.
 */
export function generateInvitationUrl(
  token: string,
  location: Pick<Location, "origin" | "pathname"> = window.location,
  org?: string | null,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
  if (org) url.searchParams.set("org", org);
  return url.toString();
}

/** The token a pasted link (or a bare token) carries, or null. */
export function parseInvitationInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.searchParams.get("invite")?.trim() || null;
  } catch {
    return /^[A-Za-z0-9_\-.]+$/.test(trimmed) ? trimmed : null;
  }
}

/** Takes `?invite=` off the address bar into storage. Run before React mounts. */
export function captureInvite(
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
  loc: Location = window.location,
): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  const org = url.searchParams.get("org");
  try {
    storage.setItem(INVITATION_STORAGE_KEY, token);
    if (org) storage.setItem(INVITATION_ORG_STORAGE_KEY, org);
    else storage.removeItem(INVITATION_ORG_STORAGE_KEY);
  } catch {
    return;
  }
  dropDeferral();
  url.searchParams.delete("invite");
  url.searchParams.delete("org");
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: Pick<Storage, "getItem"> = localStorage): string | null {
  try {
    return storage.getItem(INVITATION_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

/** The workspace a pending invitation's link named, when it named one. */
export function pendingInviteOrg(storage: Pick<Storage, "getItem"> = localStorage): string | null {
  try {
    return storage.getItem(INVITATION_ORG_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function dropInvite(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try {
    storage.removeItem(INVITATION_STORAGE_KEY);
    storage.removeItem(INVITATION_ORG_STORAGE_KEY);
  } catch {
    /* nothing stored */
  }
  dropDeferral();
}

/**
 * "Not now" on the invitation page: the ordinary landing page for the rest of
 * this tab, with the token KEPT, so signing in later still offers it.
 */
export function deferInvite(storage: Pick<Storage, "setItem"> = sessionStorage): void {
  try {
    storage.setItem(DEFERRED_KEY, "1");
  } catch {
    /* the page still moves on for this render */
  }
}

export function inviteDeferred(storage: Pick<Storage, "getItem"> = sessionStorage): boolean {
  try {
    return storage.getItem(DEFERRED_KEY) === "1";
  } catch {
    return false;
  }
}

function dropDeferral(storage: Pick<Storage, "removeItem"> = sessionStorage): void {
  try {
    storage.removeItem(DEFERRED_KEY);
  } catch {
    /* nothing stored */
  }
}

/** What to say when a token is refused for good. */
export const SPENT_INVITE =
  "This invite was already used or has expired. Ask the person who invited you for a new link.";

/**
 * Whether the node refused the token for good (unknown, used, expired,
 * revoked) rather than failing to answer: a 4xx other than 401/429, or a
 * message that says so.
 */
export function inviteRefused(error: { code?: number; message?: string } | null | undefined): boolean {
  const code = error?.code;
  if (typeof code === "number" && code >= 400 && code < 500 && code !== 401 && code !== 429) return true;
  return /unknown invite|already used|expired|revoked/i.test(error?.message ?? "");
}
