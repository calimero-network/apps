import { useCallback, useRef, useState } from 'react';
import {
  InvitationDialog,
  useInviteRedemption,
  useMero,
  type ParsedInvitation,
  type RedeemOutcome,
} from '@calimero-network/mero-react';
import { APP_DISPLAY_NAME } from '../config';
import {
  decodeInvite,
  namespaceIdOfInvite,
  type SheetsInvitePayload,
} from '../lib/inviteCodec';
import { acceptInvite, InviteRedeemError, type AcceptedInvite } from '../lib/workspaces';

/**
 * "Join X?" for an invitation that arrived as a link: mero-react's
 * `InvitationDialog`, which asks, joins, and stays up on "Syncing…" until the
 * workspace's spreadsheet list has reached this node.
 *
 * ── Why this is mounted at the APP level, not on a page ──────────────────────
 *
 * Because a link can land anywhere. mero-sheets bounces an authenticated visitor
 * from `/` straight to `/mero-sheets`, and an unauthenticated one through the
 * whole login redirect, so an effect that read `location.href` on one route
 * would miss the invitation in both of the two cases that actually happen. The
 * platform store buffers the intent until something asks for it, and this is
 * mounted where it always will.
 *
 * ── Why it asks rather than joins ────────────────────────────────────────────
 *
 * Joining is a state change: it puts you in someone else's workspace. Doing that
 * on page load makes a forwarded link, or a background tab that refreshes, join
 * silently. Decoding is pure and local, so the scope can be shown first and the
 * join needs a click.
 *
 * The join is this app's own (`acceptInvite`, which walks a chain if the code
 * carries one). The syncing stage ends when `useWorkspace`'s `useJoinSync` sees
 * the joined workspace's spreadsheets come back from the node, or its watchdog
 * decides an empty workspace really is empty.
 */
interface SheetsInvitation extends ParsedInvitation {
  payload: SheetsInvitePayload;
}

export default function InvitationPrompt({
  onJoined,
  enabled,
}: {
  /**
   * Called once a join lands, with whatever the code asked us to open. The
   * workspace state lives in `useWorkspace` on the app page, so the prompt
   * reports rather than navigates.
   */
  onJoined: (landed: Pick<AcceptedInvite, 'namespaceId' | 'contextId'>) => void;
  /** Whether there is a session to join with; the invitation waits until there is. */
  enabled: boolean;
}) {
  const { mero } = useMero();
  const [status, setStatus] = useState<string | null>(null);
  /** What the last join landed in, for `reportJoined`. */
  const landedRef = useRef<Pick<AcceptedInvite, 'namespaceId' | 'contextId'> | null>(null);

  const parse = useCallback((token: string): SheetsInvitation | null => {
    const payload = decodeInvite(token);
    if (!payload) return null;
    return {
      namespaceId: namespaceIdOfInvite(payload),
      invitation: payload.invitation,
      teamName: payload.groupAlias,
      payload,
    };
  }, []);

  const redeem = useCallback(
    async ({ payload }: SheetsInvitation): Promise<RedeemOutcome> => {
      if (!mero) {
        return {
          status: 'failed',
          namespaceId: null,
          message: 'No node connection yet. Reconnect and try again.',
          reason: 'node-unreachable',
          retryable: true,
        };
      }
      try {
        const landed = await acceptInvite(mero.admin, payload, setStatus);
        // The workspace `useWorkspace` will show and watch: it prefers the one
        // just joined, so its `useJoinSync` clears the flag this dialog waits on.
        const namespaceId = landed.namespaceId ?? namespaceIdOfInvite(payload);
        // Reported from `onJoined` below, not here: the redemption marks the
        // namespace just-joined only after this returns. A workspace the page
        // already shows settles at once, and a mark after that settle was never
        // cleared, leaving the dialog on "Syncing…".
        landedRef.current = { namespaceId, contextId: landed.contextId };
        return { status: 'joined', namespaceId, teamName: payload.groupAlias };
      } catch (e) {
        // A refused or unanswered join already says whether to keep the
        // invitation; anything else is read as unknown and kept for a retry.
        if (e instanceof InviteRedeemError) return e.outcome;
        throw e;
      } finally {
        setStatus(null);
      }
    },
    [mero],
  );

  const reportJoined = useCallback(
    (namespaceId: string) => {
      const landed = landedRef.current;
      landedRef.current = null;
      onJoined(landed?.namespaceId === namespaceId ? landed : { namespaceId, contextId: null });
    },
    [onJoined],
  );

  const redemption = useInviteRedemption({
    parse,
    redeem,
    onJoined: reportJoined,
    enabled: enabled && !!mero,
  });
  const payload = redemption.parsed?.payload;

  return (
    <InvitationDialog
      redemption={redemption}
      noun="workspace"
      appName={APP_DISPLAY_NAME}
      status={status}
      detail={
        payload?.projectName
          ? `Joining opens “${payload.projectName}” and every other spreadsheet in it.`
          : 'Joining gives you every spreadsheet in this workspace.'
      }
    />
  );
}
