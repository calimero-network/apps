/**
 * Workspace invitations on Calimero 1.0: an org invite token.
 *
 * The inviter mints the token in the shared invite dialog; the link opens this
 * frontend with `#invite=<token>`. The person opening it is usually not signed in yet, so
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

// ── Whether an invitation is still being offered ────────────────────────────
//
// ⚠️ The workspace picker (`NamespaceEntryPopup`, a full-screen overlay above
// every modal) must wait while an invitation is pending or its prompt is open.
// It used to render beside `InvitationPrompt` after sign-in and cover it, so a
// person who opened an invite link and signed in saw "Create workspace" (or
// their other workspaces) instead of the invitation's Join.

const inviteListeners = new Set<() => void>();
let promptOpen = false;

function inviteChanged(): void {
  for (const l of inviteListeners) l();
}

/** For `useSyncExternalStore`: called when the pending invitation or its prompt changes. */
export function subscribeInvite(listener: () => void): () => void {
  inviteListeners.add(listener);
  return () => {
    inviteListeners.delete(listener);
  };
}

/** `InvitationPrompt` says whether it is on screen (Join, a refusal, "already a member"). */
export function setInvitePromptOpen(open: boolean): void {
  if (promptOpen === open) return;
  promptOpen = open;
  inviteChanged();
}

/**
 * Whether an invitation is still being offered: a token waits, or its prompt
 * is showing (a refused token is dropped but its prompt stays until closed, to
 * say so). The workspace picker waits until this is false.
 */
export function invitationInFlight(): boolean {
  return promptOpen || pendingInvite() !== null;
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

/** Takes the invite (`#invite=` from the shared dialog's link, or an older `?invite=`) off the address bar into storage. Run before React mounts. */
export function captureInvite(
  storage: Pick<Storage, "setItem" | "removeItem"> = localStorage,
  loc: Location = window.location,
): void {
  const url = new URL(loc.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  const token = hash.get("invite") ?? url.searchParams.get("invite");
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
  hash.delete("invite");
  url.hash = hash.toString();
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
  inviteChanged();
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

