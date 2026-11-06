// ── Invitation links ─────────────────────────────────────────────────────────
//
// An invitation is an org invite token the node minted (`client.invite`, a
// passkey step-up). The link opens this frontend with the token in `?invite=`;
// the page takes it off the address bar into storage before anything renders
// (a person opening a link is usually not signed in yet, and the token has to
// survive the passkey sign-up), and redeems it once a session exists.
//
// v1's signed namespace payloads, the deflate + base58 codec and the
// links.calimero.network / `calimero://` deep links are gone: the token is all
// the node needs, and the frontend that redeems it is the one the cluster
// serves.

import type { KeyValueStorage } from '@calimero-apps/connect';
import { CalimeroError } from '@calimero-network/mero-js';

/** Query parameter carrying the token. */
export const INVITE_PARAM = 'invite';
/**
 * Query parameter naming the team (org) a team invitation is for. The token
 * does not say until it is redeemed, and redeeming spends a use even for
 * someone already in the team, so the link names it for the app to tell a
 * member "you are already in" first. Left off a vault invitation that also
 * admits to an invite-only vault: a team member still needs that one.
 */
export const ORG_PARAM = 'org';

const PENDING = 'mero-pass:pending-invite';
const PENDING_ORG = 'mero-pass:pending-invite-org';

/** The link that opens this frontend with `token` to redeem. */
export function invitationUrl(
  token: string,
  location: Pick<Location, 'origin' | 'pathname'> = window.location,
  org?: string,
): string {
  const trimmed = token.trim();
  if (!trimmed)
    throw new Error('cannot build an invitation link for an empty token');
  // Back to the app's root (not the page it was minted on), keeping a base path
  // such as the node's `/{version}/` where the cluster serves the bundle.
  const base = location.pathname.replace(
    /\/(teams|vault|security|share)(\/.*)?$/,
    '/',
  );
  const url = new URL(base || '/', location.origin);
  url.searchParams.set(INVITE_PARAM, trimmed);
  if (org) url.searchParams.set(ORG_PARAM, org);
  return url.toString();
}

/** What the invite modal shows: the link, and the bare token. */
export function shareableInvitation(
  token: string,
  org?: string,
): {
  link: string;
  code: string;
} {
  return {
    link: invitationUrl(token, window.location, org),
    code: token.trim(),
  };
}

/** A pasted link or bare token, as the token; null for anything else. */
export function invitationFromRaw(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const token = new URL(trimmed).searchParams.get(INVITE_PARAM);
    return token?.trim() || null;
  } catch {
    return /^[A-Za-z0-9_\-.~]+$/.test(trimmed) ? trimmed : null;
  }
}

/** Takes `?invite=` (and `?org=`) off the address bar into storage. */
export function captureInvite(
  storage: KeyValueStorage = localStorage,
  loc: Location = window.location,
): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get(INVITE_PARAM);
  if (!token) return;
  const org = url.searchParams.get(ORG_PARAM);
  try {
    storage.setItem(PENDING, token);
    if (org) storage.setItem(PENDING_ORG, org);
    else storage.removeItem(PENDING_ORG);
  } catch {
    return;
  }
  url.searchParams.delete(INVITE_PARAM);
  url.searchParams.delete(ORG_PARAM);
  window.history.replaceState(null, '', url.toString());
}

export function pendingInvite(
  storage: KeyValueStorage = localStorage,
): string | null {
  try {
    return storage.getItem(PENDING);
  } catch {
    return null;
  }
}

/** The heading over the sign-in: the invitation, when there is one. */
export function signInTitle(): string {
  return pendingInvite() ? "You're invited" : 'Sign in or create an account';
}

/** The team the pending invitation's link named, when it named one. */
export function pendingInviteOrg(
  storage: KeyValueStorage = localStorage,
): string | null {
  try {
    return storage.getItem(PENDING_ORG);
  } catch {
    return null;
  }
}

export function dropInvite(storage: KeyValueStorage = localStorage): void {
  for (const key of [PENDING, PENDING_ORG]) {
    try {
      storage.removeItem(key);
    } catch {
      /* nothing stored */
    }
  }
}

/**
 * Whether a redemption failed because the invitation itself is spent: used,
 * expired, revoked or unknown to the node. Those answer a 4xx; a 5xx or a
 * network failure is worth retrying with the same token.
 */
export function isSpentInvite(e: unknown): boolean {
  return (
    e instanceof CalimeroError &&
    e.status >= 400 &&
    e.status < 500 &&
    e.status !== 401
  );
}

/** What the invitation screen says about a spent invitation. */
export const SPENT_INVITE =
  'This invite was already used or has expired. Ask the person who invited you for a new link.';
