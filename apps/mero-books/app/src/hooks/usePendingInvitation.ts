import { useEffect, useState } from 'react';
import { onInvitation, type CapturedInvitation } from "@calimero-apps/invite";

/**
 * The invitation captured from a link, if one is waiting.
 *
 * Subscribing is cheap and the capture is sticky, so any number of components
 * may call this: the app-level route gate uses it to move the visitor to a route
 * that can redeem, and the workspace uses it to open the join dialog. Only one
 * of them acks (`invitation.resolve()`), and that clears it for both.
 */
export function usePendingInvitation(): CapturedInvitation | null {
  const [invitation, setInvitation] = useState<CapturedInvitation | null>(null);
  // `onInvitation` calls back synchronously with the current value, so this both
  // subscribes and seeds. The returned unsubscribe is the effect's cleanup.
  useEffect(() => onInvitation((next) => setInvitation(next)), []);
  return invitation;
}
