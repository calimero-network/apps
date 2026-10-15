import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  InvitationDialog,
  useInviteRedemption,
  useMero,
  type ParsedInvitation,
  type RedeemOutcome,
} from "@calimero-network/mero-react";
import { redeemInvite } from "../lib/groups";
import {
  decodeInvite,
  groupIdOfInvite,
  type StreamInvitePayload,
} from "../lib/inviteCodec";
import { setActiveRoom, setRoomName } from "../lib/session";

/**
 * "Join X?" for an invitation that arrived as a link: mero-react's
 * `InvitationDialog`, which asks, joins, and stays up on "Syncing…" until the
 * stream's data has reached this node.
 *
 * ── Why this is mounted at the APP level, not on a page ──────────────────────
 *
 * Because a link can land anywhere. The first version put this on the streams
 * page, which is wrong in a way that had already bitten once: someone with a
 * stored context is redirected to `/live` on boot, so the streams page never
 * mounts, so the invitation was never shown. That is the same shape as the bug
 * where room links pointed at a route with no redemption code — a handler that
 * only exists on one route is a handler that misses.
 *
 * ── Why it asks rather than joins ────────────────────────────────────────────
 *
 * Joining is a state change: it puts you in someone's namespace and, for a room
 * invitation, walks you into a live call. Doing that on page load makes a
 * forwarded link, or a background tab that refreshes, join silently. Decoding is
 * pure and local, so the scope can be shown first and the join needs a click.
 *
 * The join is this app's own (`redeemInvite`): a room invitation also enters
 * the room's context, and where it lands depends on which. The syncing stage
 * ends when the landing page reads the stream: RoomsPage's room list, or the
 * call's first read of its room.
 */
interface StreamInvitation extends ParsedInvitation {
  payload: StreamInvitePayload;
}

export default function InvitationPrompt() {
  // The session-aware admin: on an account the raw client's join route is the
  // relay's node route and answers 403. `redeemInvite` takes only the admin.
  const { admin } = useMero();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string | null>(null);

  const parse = useCallback((token: string): StreamInvitation | null => {
    const payload = decodeInvite(token);
    if (!payload) return null;
    return {
      namespaceId: groupIdOfInvite(payload),
      invitation: payload.invitation,
      teamName: payload.roomName ?? payload.groupAlias,
      payload,
    };
  }, []);

  const redeem = useCallback(
    async ({ payload }: StreamInvitation): Promise<RedeemOutcome> => {
      if (!admin) {
        return {
          status: "failed",
          namespaceId: null,
          message: "No node connection yet. Reconnect and try again.",
          reason: "node-unreachable",
          retryable: true,
        };
      }
      try {
        // A failed join comes back as its outcome, already carrying whether
        // the invitation is worth keeping; the hook acks or keeps it by that.
        const { outcome, landed } = await redeemInvite(
          admin,
          payload,
          setStatus,
        );
        if (!landed) return outcome;
        // The stream the landing page reads, so its `useJoinSync` clears the
        // flag the dialog is waiting on. The join's own id is the fallback for
        // a code that named no destination.
        let namespaceId = outcome.namespaceId;
        if (landed.kind === "room") {
          if (landed.roomName) setRoomName(landed.contextId, landed.roomName);
          setActiveRoom(landed.contextId, landed.identity, landed.namespaceId);
          namespaceId = landed.namespaceId ?? namespaceId;
          navigate("/live");
        } else if (landed.kind === "namespace") {
          namespaceId = landed.namespaceId;
          navigate(`/streams/${landed.namespaceId}`);
        } else {
          navigate("/streams");
        }
        return {
          status: outcome.status,
          namespaceId,
          teamName: payload.roomName ?? payload.groupAlias,
        };
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
      noun="stream"
      appName="Mero Stream"
      status={status}
      detail={
        payload?.roomName
          ? "Joining takes you straight into that call."
          : "Joining gives you access to the stream and every room in it."
      }
    />
  );
}
