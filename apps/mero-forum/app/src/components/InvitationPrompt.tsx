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
  type ForumInvitePayload,
} from "../lib/inviteCodec";
import { setActiveForum, setForumName } from "../lib/session";

/**
 * "Join X?" for an invitation that arrived as a link: mero-react's
 * `InvitationDialog`, which asks, joins, and stays up on "Syncing…" until the
 * space's data has reached this node.
 *
 * ── Why this is mounted at the APP level, not on a page ──────────────────────
 *
 * Because a link can land anywhere. The first version put this on the spaces
 * page, which is wrong in a way that had already bitten once: someone with a
 * stored context is redirected to `/live` on boot, so the spaces page never
 * mounts, so the invitation was never shown. That is the same shape as the bug
 * where forum links pointed at a route with no redemption code — a handler that
 * only exists on one route is a handler that misses.
 *
 * ── Why it asks rather than joins ────────────────────────────────────────────
 *
 * Joining is a state change: it puts you in someone's namespace and, for a forum
 * invitation, walks you into a live call. Doing that on page load makes a
 * forwarded link, or a background tab that refreshes, join silently. Decoding is
 * pure and local, so the scope can be shown first and the join needs a click.
 *
 * The join is this app's own (`redeemInvite`): a forum invitation also enters
 * the forum's context, and where it lands depends on which. The syncing stage
 * ends when the landing page reads the space: ForumsPage's forum list, or
 * FeedPage's first page of posts.
 */
interface ForumInvitation extends ParsedInvitation {
  payload: ForumInvitePayload;
}

export default function InvitationPrompt() {
  const { mero } = useMero();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string | null>(null);

  const parse = useCallback((token: string): ForumInvitation | null => {
    const payload = decodeInvite(token);
    if (!payload) return null;
    return {
      namespaceId: groupIdOfInvite(payload),
      invitation: payload.invitation,
      teamName: payload.forumName ?? payload.groupAlias,
      payload,
    };
  }, []);

  const redeem = useCallback(
    async ({ payload }: ForumInvitation): Promise<RedeemOutcome> => {
      if (!mero) {
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
          mero.admin,
          payload,
          setStatus,
        );
        if (!landed) return outcome;
        // The space the landing page reads, so its `useJoinSync` clears the
        // flag the dialog is waiting on. The join's own id is the fallback for
        // a code that named no destination.
        let namespaceId = outcome.namespaceId;
        if (landed.kind === "forum") {
          if (landed.forumName)
            setForumName(landed.contextId, landed.forumName);
          setActiveForum(landed.contextId, landed.identity, landed.namespaceId);
          namespaceId = landed.namespaceId ?? namespaceId;
          navigate("/f");
        } else if (landed.kind === "namespace") {
          namespaceId = landed.namespaceId;
          navigate(`/spaces/${landed.namespaceId}`);
        } else {
          navigate("/spaces");
        }
        return {
          status: outcome.status,
          namespaceId,
          teamName: payload.forumName ?? payload.groupAlias,
        };
      } finally {
        setStatus(null);
      }
    },
    [mero, navigate],
  );

  const redemption = useInviteRedemption({ parse, redeem, enabled: !!mero });
  const payload = redemption.parsed?.payload;

  return (
    <InvitationDialog
      redemption={redemption}
      noun="space"
      appName="Mero Forum"
      status={status}
      detail={
        payload?.forumName
          ? "Joining takes you straight into that forum."
          : "Joining gives you access to the space and every forum in it."
      }
    />
  );
}
