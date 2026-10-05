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

import { describeInviteFailure, shouldRetain } from '@calimero-apps/invite';

import type { PassInvitePayload } from '../lib/inviteCodec';
import { destinationFor } from '../lib/redeemFlow';
import { InviteRedeemError, redeemInvite } from '../lib/vaults';
import { describeError } from '../lib/errors';

/** What one redeem ended in, for the two callers' different decisions. */
export interface RedeemResult {
  /** Where it navigated, or `null` when the join did not happen. */
  destination: string | null;
  /**
   * Whether a captured invitation should be KEPT for another attempt: true for
   * a failure a later try could fix (no member online yet, a flaky node), false
   * once it joined or the node refused the invitation for good.
   */
  retain: boolean;
}

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
   * @returns the destination path on success (`null` on failure), and whether
   * the invitation is worth keeping.
   *
   * ⚠️ Reports a failed join rather than throwing, because the two callers do
   * different things with it. The link prompt must NOT ack the captured intent
   * on a transient failure (no online member yet, a flaky node) — the platform
   * store exists so the invitation survives to be retried — but should ack one
   * the node refused for good, or it replays a dead link on every load. The
   * paste field has nothing to ack.
   *
   * ⚠️ And it returns the DESTINATION, not a boolean, because "navigated" is
   * not the same as "the screen changed". A join that cannot be placed
   * resolves to `/teams` — which is where the paste field already is, so
   * React Router does not remount, the list never reloads, and a successful
   * join looks like nothing happened. A caller already on the destination has
   * to refresh itself, and it can only know that if it is told where it went.
   */
  redeem: (payload: PassInvitePayload) => Promise<RedeemResult>;
}

export function useRedeemInvitation(): RedeemState {
  // `admin`, never `mero.admin`. On an account the join has to go through the
  // account admin — it asks a node named in the invitation to admit this
  // account — and the raw client's `POST /admin-api/namespaces/{id}/join` is
  // a 403 on the relay. On a node the two are the same client.
  const { admin } = useMero();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const redeem = useCallback(
    async (payload: PassInvitePayload): Promise<RedeemResult> => {
      if (!admin) {
        setError('No node connection yet. Reconnect and try again.');
        return { destination: null, retain: true };
      }
      setBusy(true);
      setError(null);
      try {
        const landed = await redeemInvite(admin, payload, setStatus);
        const destination = destinationFor(landed);
        navigate(destination);
        return { destination, retain: false };
      } catch (e) {
        if (e instanceof InviteRedeemError) {
          // The team join itself failed: say why in terms a person can act
          // on, and let the outcome decide whether the invitation is kept.
          const { outcome } = e;
          setError(
            describeInviteFailure(outcome.reason, 'team') ??
              describeError(outcome.message),
          );
          return { destination: null, retain: shouldRetain(outcome) };
        }
        setError(describeError(e));
        return { destination: null, retain: true };
      } finally {
        setBusy(false);
        setStatus(null);
      }
    },
    [admin, navigate],
  );

  return { busy, status, error, setError, redeem };
}
