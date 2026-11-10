// ── Invitation links ─────────────────────────────────────────────────────────
//
// An invitation is an org invite token the node minted (`client.invite`, a
// passkey step-up). The link opens this frontend with the token in `?invite=`;
// the page takes it off the address bar into the shared invite store
// (`@calimero-apps/connect`) before anything renders (a person opening a link
// is usually not signed in yet, and the token has to survive the passkey
// sign-up), and redeems it once a session exists and the person says yes.
//
// v1's signed namespace payloads, the deflate + base58 codec and the
// links.calimero.network / `calimero://` deep links are gone: the token is all
// the node needs, and the frontend that redeems it is the one the cluster
// serves.

import {
  createInviteStore,
  inviteLink,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite,
} from '@calimero-apps/connect';

import { basename } from './basename';

/** Query parameter carrying the token. */
export const INVITE_PARAM = 'invite';

/**
 * The link that opens this frontend with `token` to redeem, at the app's root
 * (not the page it was minted on). With `org`, it names the team (org) a team
 * invitation is for: the token does not say until it is redeemed, and
 * redeeming spends a use even for someone already in the team, so the link
 * names it for the app to tell a member "you are already in" first. Left off a
 * vault invitation that also admits to an invite-only vault: a team member
 * still needs that one.
 *
 * The link stays under the served `/{version}/` root until every cluster's
 * served-host redirect keeps the query string (core's served-redirect fix).
 */
export function invitationUrl(
  token: string,
  location: Pick<Location, 'origin' | 'pathname'> = window.location,
  org?: string,
): string {
  const trimmed = token.trim();
  if (!trimmed)
    throw new Error('cannot build an invitation link for an empty token');
  return inviteLink(trimmed, {
    org,
    root: basename(location.pathname),
    origin: location.origin,
  });
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

/** This app's pending invite, captured in `index.tsx` before React mounts. */
export const invites = createInviteStore('mero-pass');

const LEGACY_PENDING = 'mero-pass:pending-invite';
const LEGACY_ORG = 'mero-pass:pending-invite-org';

/**
 * Moves an invite an earlier build stored under its own keys into the shared
 * store, so a link opened before the upgrade still joins after it.
 */
export function migrateLegacyInvite(
  storage: KeyValueStorage = localStorage,
  store: InviteStore = invites,
): void {
  try {
    const token = storage.getItem(LEGACY_PENDING);
    if (token) {
      store.put({
        token,
        org: storage.getItem(LEGACY_ORG),
        team: null,
        doc: null,
        route: null,
        extra: {},
      });
    }
    for (const key of [LEGACY_PENDING, LEGACY_ORG]) storage.removeItem(key);
  } catch {
    /* storage unavailable: nothing was stored */
  }
}

/** The heading over the sign-in: the invitation, when there is one. */
export function signInTitle(): string {
  return invites.token() ? "You're invited" : 'Sign in or create an account';
}

/**
 * Set when a sign-up joined with the page's invite, before the session is
 * signed in: the team it joined (`null` when that cannot be told). The
 * invitation prompt (inside the router, which the session is not) takes it
 * once signed in and opens the team.
 */
let joinedAtSignUp: { org: string | null } | null = null;

/** `onJoinedAtSignUp` for `usePasskeySession`: remember the team to open. */
export function noteJoinedAtSignUp(
  { org }: { org: string | null },
  pending: PendingInvite | null,
): void {
  joinedAtSignUp = { org: org ?? pending?.org ?? null };
}

/** The team a sign-up just joined with the invite, once; `null` when none did. */
export function takeJoinedAtSignUp(): { org: string | null } | null {
  const joined = joinedAtSignUp;
  joinedAtSignUp = null;
  return joined;
}
