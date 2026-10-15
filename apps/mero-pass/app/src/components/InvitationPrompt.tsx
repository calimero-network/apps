import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  InvitationDialog,
  useInviteRedemption,
  useMero,
  type ParsedInvitation,
  type RedeemOutcome,
} from '@calimero-network/mero-react';
import {
  decodeInvite,
  groupIdOfInvite,
  type PassInvitePayload,
} from '../lib/inviteCodec';
import { destinationFor } from '../lib/redeemFlow';
import { InviteRedeemError, redeemInvite } from '../lib/vaults';

/**
 * "Join X?" for an invitation that arrived as a link: mero-react's
 * `InvitationDialog`, which asks, joins, and stays up on "Syncing…" until the
 * team's data has reached this node.
 *
 * ── Why this is mounted at the APP level, not on a page ──────────────────────
 *
 * Because a link can land anywhere. Mero Pass has a marketing landing page on
 * `/`, a redirect on `/login`, a home page and a vault page, and the desktop
 * launcher can append `?invitation=…` to whichever of them it was given. A
 * prompt that lives on one route is a prompt that misses.
 *
 * ── Why it asks rather than joins ────────────────────────────────────────────
 *
 * Joining is a state change: it puts you in someone else's team and gives them
 * a peer that syncs their secrets. Doing that on page load makes a forwarded
 * link, or a background tab that refreshes, join silently. Decoding is pure and
 * local, so the scope can be shown first and the join needs a click.
 *
 * The join is this app's own (`redeemInvite`): a vault invitation also enters
 * the vault's context, and `destinationFor` picks where it lands. The syncing
 * stage ends when TeamPage's `useJoinSync` sees the team's vaults arrive.
 */
interface PassInvitation extends ParsedInvitation {
  payload: PassInvitePayload;
}

export default function InvitationPrompt() {
  // `admin`, the session-aware client: on an account the raw client's admin
  // is the node route, which a delegated session cannot use.
  const { admin } = useMero();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string | null>(null);

  const parse = useCallback((token: string): PassInvitation | null => {
    const payload = decodeInvite(token);
    if (!payload) return null;
    return {
      namespaceId: groupIdOfInvite(payload),
      invitation: payload.invitation,
      teamName: payload.vaultName ?? payload.groupAlias,
      payload,
    };
  }, []);

  const redeem = useCallback(
    async ({ payload }: PassInvitation): Promise<RedeemOutcome> => {
      if (!admin) {
        return {
          status: 'failed',
          namespaceId: null,
          message: 'No node connection yet. Reconnect and try again.',
          reason: 'node-unreachable',
          retryable: true,
        };
      }
      try {
        const landed = await redeemInvite(admin, payload, setStatus);
        navigate(destinationFor(landed));
        // The TEAM's namespace, which TeamPage's `useJoinSync` watches. For a
        // vault invitation the signed group is the vault's subgroup, so the
        // payload alone would name a flag nothing ever clears.
        const namespaceId =
          ('namespaceId' in landed && landed.namespaceId) || groupIdOfInvite(payload);
        return {
          status: 'joined',
          namespaceId,
          teamName: payload.vaultName ?? payload.groupAlias,
        };
      } catch (e) {
        if (e instanceof InviteRedeemError) return e.outcome;
        throw e;
      } finally {
        setStatus(null);
      }
    },
    [admin, navigate],
  );

  const redemption = useInviteRedemption({ parse, redeem, enabled: !!admin });
  const payload = redemption.parsed?.payload;

  return (
    <InvitationDialog
      redemption={redemption}
      noun="team"
      appName="Mero Pass"
      status={status}
      // Deliberately explicit about the real grant. A vault invitation is a
      // SPACE invitation underneath, because vault access is inherited, and the
      // person being asked to accept is entitled to know that before they click.
      detail={
        payload?.vaultName
          ? 'Joining gives you this vault and the rest of the team it belongs to.'
          : 'Joining gives you access to the team and every vault in it.'
      }
    />
  );
}
