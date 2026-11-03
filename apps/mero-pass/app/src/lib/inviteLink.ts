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

/** Query parameter carrying the token. */
export const INVITE_PARAM = 'invite';

const PENDING = 'mero-pass:pending-invite';

/** The link that opens this frontend with `token` to redeem. */
export function invitationUrl(
  token: string,
  location: Pick<Location, 'origin' | 'pathname'> = window.location,
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
  return url.toString();
}

/** What the invite modal shows: the link, and the bare token. */
export function shareableInvitation(token: string): {
  link: string;
  code: string;
} {
  return { link: invitationUrl(token), code: token.trim() };
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

/** Takes `?invite=` off the address bar into storage. */
export function captureInvite(
  storage: KeyValueStorage = localStorage,
  loc: Location = window.location,
): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get(INVITE_PARAM);
  if (!token) return;
  try {
    storage.setItem(PENDING, token);
  } catch {
    return;
  }
  url.searchParams.delete(INVITE_PARAM);
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

export function dropInvite(storage: KeyValueStorage = localStorage): void {
  try {
    storage.removeItem(PENDING);
  } catch {
    /* nothing stored */
  }
}
