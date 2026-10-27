import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  InvitationDialog,
  InvitationGate,
  useInviteRedemption,
  useMero,
  type ParsedInvitation,
  type RedeemOutcome,
} from "@calimero-apps/cloud";
import { invitedNamespaceOf, redeemInvite } from "../lib/groups";
import { decodeInvite, type AudienceInvitePayload } from "../lib/inviteCodec";
import { setActiveAudience, setAudienceName } from "../lib/session";

/**
 * "Join X?" for an invitation that arrived as a link: mero-react's
 * `InvitationDialog`, which asks, joins, and stays up on "Syncing…" until the
 * joined company's data has reached this node.
 *
 * ── Why this is mounted at the APP level, not on a page ──────────────────────
 *
 * Because a link can land anywhere. The first version put this on the spaces
 * page, which is wrong in a way that had already bitten once: someone with a
 * stored context is redirected to `/live` on boot, so the spaces page never
 * mounts, so the invitation was never shown. That is the same shape as the bug
 * where audience links pointed at a route with no redemption code — a handler that
 * only exists on one route is a handler that misses.
 *
 * ── Why it asks rather than joins ────────────────────────────────────────────
 *
 * Joining is a state change: it puts you in someone's namespace and, for an audience
 * invitation, walks you into a live call. Doing that on page load makes a
 * forwarded link, or a background tab that refreshes, join silently. Decoding is
 * pure and local, so the scope can be shown first and the join needs a click.
 *
 * The join is this app's own (`redeemInvite`): an audience invitation also
 * enters the audience's context. The syncing stage ends when the page it lands
 * on has read the company: AudiencesPage's audience list, or UpdatesPage's
 * feed for an audience invitation, each through `useJoinSync`.
 */
interface UpdatesInvitation extends ParsedInvitation {
  payload: AudienceInvitePayload;
}

export default function InvitationPrompt() {
  // The session-aware admin: on an account the raw client's join route is the
  // relay's node route and answers 403. `redeemInvite` takes only the admin.
  const { admin, nodeUrl } = useMero();
  const navigate = useNavigate();
  const [status, setStatus] = useState<string | null>(null);

  const parse = useCallback((token: string): UpdatesInvitation | null => {
    const payload = decodeInvite(token);
    if (!payload) return null;
    return {
      namespaceId: invitedNamespaceOf(payload),
      invitation: payload.invitation,
      teamName: payload.audienceName ?? payload.groupAlias,
      payload,
    };
  }, []);

  const redeem = useCallback(
    async ({
      payload,
      namespaceId,
    }: UpdatesInvitation): Promise<RedeemOutcome> => {
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
        const { outcome, landed } = await redeemInvite(
          admin,
          payload,
          setStatus,
        );
        if (!landed) return outcome;
        let joinedId = namespaceId;
        if (landed.kind === "audience") {
          if (landed.audienceName)
            setAudienceName(landed.contextId, landed.audienceName);
          // The audience's company becomes the active one, which is what
          // UpdatesPage's `useJoinSync` watches.
          joinedId = landed.namespaceId ?? namespaceId;
          setActiveAudience(
            landed.contextId,
            landed.identity,
            joinedId,
            nodeUrl,
          );
          navigate("/a");
        } else if (landed.kind === "namespace") {
          joinedId = landed.namespaceId;
          navigate(`/companies/${landed.namespaceId}`);
        } else {
          navigate("/companies");
        }
        return {
          status: "joined",
          namespaceId: joinedId,
          teamName: payload.audienceName ?? payload.groupAlias,
        };
      } finally {
        setStatus(null);
      }
    },
    [admin, navigate, nodeUrl],
  );

  const redemption = useInviteRedemption({ parse, redeem, enabled: !!admin });
  const payload = redemption.parsed?.payload;

  return (
    <>
      {/* Logged out with a link opened: "you're invited" and the login, not the landing page. */}
      <InvitationGate parse={parse} noun="company" appName="Mero Updates" />
      <InvitationDialog
        redemption={redemption}
        noun="company"
        appName="Mero Updates"
        status={status}
        detail={
          payload?.audienceName
            ? "Joining takes you straight into that audience."
            : "Joining gives you access to the space and every audience in it."
        }
      />
    </>
  );
}
