// ── Accepting an invitation, from either door ───────────────────────────────
//
// An invitation reaches this app two ways: as a LINK, captured before React
// mounts and offered by `components/InvitationPrompt`, or as TEXT someone
// pasted into the field on the teams screen. What happens after that string is
// in hand is identical, and it is not trivial — redeem, then work out where the
// person now belongs, then go there.
//
// It lived in the prompt, which is why the paste field could not exist without
// either duplicating it or lifting it. Lifted.

import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMero } from '@calimero-network/mero-react';

import type { PassInvitePayload } from '../lib/inviteCodec';
import { destinationFor } from '../lib/redeemFlow';
import { redeemInvite } from '../lib/vaults';

export interface RedeemState {
  /** A redeem is in flight. Disable the control that started it. */
  busy: boolean;
  /** Which slow step it is on, from `redeemInvite`. */
  status: string | null;
  error: string | null;
  setError: (message: string | null) => void;
  /**
   * Redeem a decoded invitation and navigate to wherever it landed.
   *
   * @returns true when the join succeeded and navigation happened.
   *
   * ⚠️ Returns FALSE rather than throwing on a failed join, because the two
   * callers do different things with that. The link prompt must NOT ack the
   * captured intent — a failure there is usually transient (no online member
   * yet, a flaky node) and the platform store exists so the invitation
   * survives to be retried. The paste field has nothing to ack.
   */
  redeem: (payload: PassInvitePayload) => Promise<boolean>;
}

export function useRedeemInvitation(): RedeemState {
  const { mero } = useMero();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const redeem = useCallback(
    async (payload: PassInvitePayload): Promise<boolean> => {
      if (!mero) {
        setError('No node connection yet. Reconnect and try again.');
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const landed = await redeemInvite(mero.admin, payload, setStatus);
        navigate(destinationFor(landed));
        return true;
      } catch (e) {
        setError(
          e instanceof Error ? e.message : 'Could not accept the invitation.',
        );
        return false;
      } finally {
        setBusy(false);
        setStatus(null);
      }
    },
    [mero, navigate],
  );

  return { busy, status, error, setError, redeem };
}
