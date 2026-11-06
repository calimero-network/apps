/**
 * Invitations on Calimero 1.0: an ORG invite token (a workspace is an org),
 * minted with the inviter's passkey (`client.invite` is a 412 step-up) and
 * redeemed after the invitee signs in (`client.redeemInvite`). The link is this
 * frontend's own URL with `?invite=<token>`, plus `&agreement=<app id>` when it
 * was shared from an agreement, so the joiner lands in it.
 *
 * Replaces v1's signed namespace invitations, which travelled as a
 * deflate+base58 payload (`inviteCodec`) on a registry deep link.
 */
import { CalimeroError, type CalimeroClient, type PasskeyProvider } from '@calimero-network/mero-js';
import type { KeyValueStorage } from '@calimero-apps/connect';

export interface PendingInvite {
  token: string;
  /** The agreement (app instance) the link lands in, when it names one. */
  agreement: string | null;
  /** The workspace (org) the token admits to, when the link names it. */
  org: string | null;
}

const PENDING = 'mero-sign:pending-invite';

/** An invitation into `org` as a member, approved with the inviter's passkey. */
export function inviteToken(
  client: Pick<CalimeroClient, 'invite'>,
  org: string,
  passkey: PasskeyProvider,
): Promise<string> {
  return client.invite(org, 'member', passkey);
}

/**
 * The link that opens this frontend with `token` to redeem. `org` names the
 * workspace the token admits to, so someone already in it (the inviter
 * opening their own link, say) is told so instead of spending the token's
 * single use.
 */
export function inviteLink(
  token: string,
  agreement?: string | null,
  location: Pick<Location, 'origin' | 'pathname'> = window.location,
  org?: string | null,
): string {
  const url = new URL(location.pathname, location.origin);
  url.searchParams.set('invite', token);
  if (agreement) url.searchParams.set('agreement', agreement);
  if (org) url.searchParams.set('org', org);
  return url.toString();
}

/**
 * Takes `?invite=` (and `&agreement=`) off the address bar into storage,
 * before anything renders: a person opening a link is usually not signed in
 * yet, and the token has to survive the passkey sign-up.
 */
export function captureInvite(
  storage: KeyValueStorage = localStorage,
  loc: Location = window.location,
): void {
  const url = new URL(loc.href);
  const token = url.searchParams.get('invite');
  if (!token) return;
  const pending: PendingInvite = {
    token,
    agreement: url.searchParams.get('agreement'),
    org: url.searchParams.get('org'),
  };
  try {
    storage.setItem(PENDING, JSON.stringify(pending));
  } catch {
    return;
  }
  url.searchParams.delete('invite');
  url.searchParams.delete('agreement');
  url.searchParams.delete('org');
  window.history.replaceState(null, '', url.toString());
}

export function pendingInvite(
  storage: KeyValueStorage = localStorage,
): PendingInvite | null {
  try {
    const raw = storage.getItem(PENDING);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingInvite>;
    return typeof parsed.token === 'string' && parsed.token
      ? {
          token: parsed.token,
          agreement:
            typeof parsed.agreement === 'string' ? parsed.agreement : null,
          org: typeof parsed.org === 'string' ? parsed.org : null,
        }
      : null;
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

/** The org an invitation redeemed into, from whichever field the node named it. */
export function joinedOrg(redeemed: Record<string, unknown>): string | null {
  for (const key of ['org', 'orgId']) {
    const v = redeemed[key];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

/**
 * What to say when the node refused an invitation: it is unknown, already
 * used, expired or revoked. A 4xx can never succeed on retry, so the caller
 * drops the token; anything else (the cluster unreachable) is kept.
 */
export const INVITE_REFUSED =
  'This invite was already used or has expired. Ask the person who invited you for a new link.';

/** True when `e` is the node refusing the invitation itself (see `INVITE_REFUSED`). */
export function inviteRefused(e: unknown): boolean {
  return e instanceof CalimeroError && e.status >= 400 && e.status < 500;
}

/**
 * Whether this account is already in the workspace an invitation admits to:
 * `true` or `false` when the link names its org, `null` when it cannot be
 * told (an older link). Redeeming as an existing member spends the token's
 * single use, which then leaves the person it was meant for unable to join.
 */
export async function alreadyMember(
  client: Pick<CalimeroClient, 'me'>,
  invite: PendingInvite,
): Promise<boolean | null> {
  if (!invite.org) return null;
  try {
    const me = (await client.me()) as {
      orgs?: Array<{ orgId?: unknown }>;
    };
    return (me.orgs ?? []).some((o) => o.orgId === invite.org);
  } catch {
    return null;
  }
}
