// ── Turning "what someone sent me" into a place to land ─────────────────────
//
// An invitation reaches this app one way: its link is opened, and the prompt
// (`components/InvitationPrompt`) offers it. Where it lands after the join is
// decided here, as a pure function, because it went wrong once: the prompt
// navigated to `/team/<id>` — singular, a
// path with NO route in `App.tsx` — so accepting a team invitation fell
// through to the catch-all and dumped you on the teams list instead of in the
// team you had just joined. It looked like it worked, which is why it lasted.
// One function, one test, one answer.

import type { Redeemed } from './vaults';

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
