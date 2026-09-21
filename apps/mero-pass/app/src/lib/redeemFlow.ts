// ── Turning "what someone sent me" into a place to land ─────────────────────
//
// Two entry points redeem an invitation: the prompt that fires when a LINK is
// opened (`components/InvitationPrompt`), and the paste field on the teams
// screen for when it arrived as text (`pages/teams/TeamsPage`). They differ
// only in where the string came from.
//
// Both halves live here, as pure functions, because the two of them had
// already drifted once: the prompt navigated to `/team/<id>` — singular, a
// path with NO route in `App.tsx` — so accepting a team invitation fell
// through to the catch-all and dumped you on the teams list instead of in the
// team you had just joined. It looked like it worked, which is why it lasted.
// One function, one test, one answer.

import { decodeInvite, type PassInvitePayload } from './inviteCodec';
import { invitationFromRaw } from './inviteLink';
import type { Redeemed } from './vaults';

/**
 * Parse whatever was pasted or opened — an https link, a `calimero://` deep
 * link, or the bare code — into something redeemable.
 *
 * Null means "this is not a Mero Pass invitation", which is a different thing
 * from "this invitation failed", and the caller should say so differently.
 */
export function parseInvitation(raw: string): PassInvitePayload | null {
  const code = invitationFromRaw(raw);
  if (!code) return null;
  return decodeInvite(code);
}

/**
 * Where a redeemed invitation should land.
 *
 * ⚠️ `/teams/<id>`, PLURAL. The route table declares `/teams/:teamId`; there
 * is no `/team/:teamId`, and navigating to one hits `*` → `/teams`. The bug
 * this replaces was exactly one character.
 */
export function destinationFor(landed: Redeemed): string {
  switch (landed.kind) {
    case 'vault':
      return `/vault/${landed.contextId}`;
    case 'team':
      return `/teams/${landed.namespaceId}`;
    default:
      // Joined something this node cannot yet place — the team exists but its
      // vaults have not replicated here. The teams list is the honest landing
      // place: it will show the new team as soon as it syncs.
      return '/teams';
  }
}

/** What to show when a string is not an invitation at all. */
export const NOT_AN_INVITATION =
  'That does not look like a Mero Pass invitation. Paste the link or the code you were sent.';
