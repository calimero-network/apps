// ── Invitations on Calimero 1.0 ──────────────────────────────────────────────
//
// An invitation is an org invite: the inviter mints a token with their passkey
// (`client.invite`), the link carries it as `?invite=` (and, when it was minted
// from an agreement, `&agreement=<app id>` as a hint where to land), and the
// invitee redeems it once signed in. v1's signed envelopes, the registry deep
// links and the desktop launcher's hand-off are gone.

import type { KeyValueStorage } from '@calimero-apps/connect';

export const INVITE_PARAM = 'invite';
export const AGREEMENT_PARAM = 'agreement';
const PENDING = 'mero-sign:pending-invite';

export interface PendingInvite {
  token: string;
  /** The agreement the inviter shared, if any: a hint, honoured only inside the workspace joined. */
  agreement?: string;
}

/** The link that opens this frontend with `token` to redeem. */
export function invitationUrl(
  token: string,
  agreement?: string,
  location: Pick<Location, 'origin' | 'pathname'> = window.location,
): string {
  const trimmed = token.trim();
  if (!trimmed) throw new Error('cannot build an invitation link for an empty token');
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set(INVITE_PARAM, trimmed);
  if (agreement) url.searchParams.set(AGREEMENT_PARAM, agreement);
  return url.toString();
}

/**
 * Takes `?invite=` off the address bar into storage, before anything renders:
 * a person opening a link is usually not signed in yet, and the token must
 * survive the passkey sign-up. Redeemed (and dropped) once a session exists.
 */
export function captureInvite(
  storage: KeyValueStorage = localStorage,
  loc: Pick<Location, 'href'> = window.location,
  replace: (url: string) => void = (u) => window.history.replaceState(null, '', u),
): PendingInvite | null {
  const url = new URL(loc.href);
  const token = url.searchParams.get(INVITE_PARAM);
  if (!token) return null;
  const pending: PendingInvite = { token };
  const agreement = url.searchParams.get(AGREEMENT_PARAM);
  if (agreement) pending.agreement = agreement;
  try {
    storage.setItem(PENDING, JSON.stringify(pending));
  } catch {
    return pending;
  }
  url.searchParams.delete(INVITE_PARAM);
  url.searchParams.delete(AGREEMENT_PARAM);
  replace(url.toString());
  return pending;
}

export function pendingInvite(storage: KeyValueStorage = localStorage): PendingInvite | null {
  try {
    const raw = storage.getItem(PENDING);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof (parsed as PendingInvite).token === 'string') return parsed as PendingInvite;
  } catch {
    /* nothing usable stored */
  }
  return null;
}

export function dropInvite(storage: KeyValueStorage = localStorage): void {
  try {
    storage.removeItem(PENDING);
  } catch {
    /* nothing stored */
  }
}
