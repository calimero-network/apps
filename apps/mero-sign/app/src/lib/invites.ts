/**
 * Invitations on Calimero 1.0: an ORG invite token (a workspace is an org),
 * minted and redeemed through mero-react's shared dialogs. The link is this
 * frontend's own URL carrying the token, plus `agreement=<app id>` when it was
 * shared from an agreement, so the joiner lands in it.
 *
 * Replaces v1's signed namespace invitations, which travelled as a
 * deflate+base58 payload (`inviteCodec`) on a registry deep link.
 */
import {
  createInviteStore,
  inviteLinkBase,
  type InviteStore,
  type KeyValueStorage,
  type PendingInvite as SharedPendingInvite,
} from '@calimero-apps/connect';
import { nodeBasename } from '@calimero-apps/node-served';

export interface PendingInvite {
  token: string;
  /** The agreement (app instance) the link lands in, when it names one. */
  agreement: string | null;
  /** The workspace (org) the token admits to, when the link names it. */
  org: string | null;
}

const LEGACY_PENDING = 'mero-sign:pending-invite';

/**
 * The page the shared invite dialog's link opens: this frontend's root (under
 * the served `/{version}/` until every cluster's served-host redirect keeps
 * the query string), naming the workspace so someone already in it is told so
 * instead of spending the token's single use, and the agreement when there is one.
 */
export function inviteBase(
  org: string,
  agreement?: string | null,
  location: Pick<Location, 'href'> = window.location,
): string {
  const url = new URL(location.href);
  return inviteLinkBase({ org, extra: { agreement }, root: nodeBasename(url, '/'), origin: url.origin });
}

/** This app's pending invite (`@calimero-apps/connect`), with the agreement its link lands in. */
export const invites = createInviteStore('mero-sign', { keep: ['agreement'] });

/**
 * Takes `?invite=` (and `&agreement=`, `&org=`) off the address bar into the
 * store, before anything renders: a person opening a link is usually not
 * signed in yet, and the token has to survive the passkey sign-up. An invite
 * an earlier build stored under its own key moves over first.
 */
export function captureInvite(
  loc: Pick<Location, 'href'> = window.location,
): void {
  migrateLegacyInvite();
  invites.capture(loc, { basename: nodeBasename(new URL(loc.href), '/') });
}

/** Moves an invite an earlier build stored under its own key into the shared store. */
export function migrateLegacyInvite(
  storage: KeyValueStorage = localStorage,
  into: InviteStore = invites,
): void {
  try {
    const raw = storage.getItem(LEGACY_PENDING);
    if (!raw) return;
    storage.removeItem(LEGACY_PENDING);
    const old = JSON.parse(raw) as Partial<PendingInvite>;
    if (typeof old.token !== 'string' || !old.token) return;
    into.put({
      token: old.token,
      org: typeof old.org === 'string' && old.org ? old.org : null,
      team: null,
      doc: null,
      route: null,
      extra:
        typeof old.agreement === 'string' && old.agreement
          ? { agreement: old.agreement }
          : {},
    });
  } catch {
    /* unreadable: nothing to move */
  }
}

/** The app's view of a pending invite. */
export function signInvite(
  pending: SharedPendingInvite | null,
): PendingInvite | null {
  return pending
    ? {
        token: pending.token,
        agreement: pending.extra.agreement ?? null,
        org: pending.org,
      }
    : null;
}

/**
 * The invite a sign-up from this page joined with, kept after the store
 * dropped it: `InvitationHandlerPopup` mounts once signed in, and opens what
 * the link named from it (nothing is redeemed again).
 */
let joinedAtSignUp: PendingInvite | null = null;

/** `onJoinedAtSignUp` for `usePasskeySession`. */
export function noteJoinedAtSignUp(
  joined: { invite: string; org: string | null },
  pending: SharedPendingInvite | null,
): void {
  const invite = signInvite(pending);
  joinedAtSignUp = invite
    ? { ...invite, org: joined.org ?? invite.org }
    : { token: joined.invite, agreement: null, org: joined.org };
}

/** The pending invite, or the one a sign-up just joined with. */
export function pendingInvite(): PendingInvite | null {
  return signInvite(invites.pending()) ?? joinedAtSignUp;
}

export function dropInvite(): void {
  invites.drop();
  joinedAtSignUp = null;
}
