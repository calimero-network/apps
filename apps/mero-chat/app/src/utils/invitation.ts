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

/** The link that opens this frontend with `token` to redeem. */
export function generateInvitationUrl(
  token: string,
  location: Pick<Location, "origin" | "pathname"> = window.location,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set("invite", token);
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
  storage: Pick<Storage, "setItem"> = localStorage,
  loc: Location = window.location,
): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get("invite");
  if (!token) return;
  try {
    storage.setItem(INVITATION_STORAGE_KEY, token);
  } catch {
    return;
  }
  url.searchParams.delete("invite");
  window.history.replaceState(null, "", url.toString());
}

export function pendingInvite(storage: Pick<Storage, "getItem"> = localStorage): string | null {
  try {
    return storage.getItem(INVITATION_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function dropInvite(storage: Pick<Storage, "removeItem"> = localStorage): void {
  try {
    storage.removeItem(INVITATION_STORAGE_KEY);
  } catch {
    /* nothing stored */
  }
}
