import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  InviteStatusBanner,
  useInviteRedemption,
  type ParsedInvitation,
} from "@calimero-apps/invite";
import type { SignedGroupOpenInvitation } from "@calimero-network/mero-js";
import { useMero } from "@calimero-network/mero-react";
import { useApi } from "../api/useApi";
import { useToast } from "../contexts/ToastContext";
import { decodeInvitationObject } from "../utils/invitation";
import { setStoredTeamName } from "../utils/teamName";

/** Read a raw invitation token into the parts the join needs. */
function parseTeamInvitation(raw: string): ParsedInvitation | null {
  const invObj = decodeInvitationObject<Record<string, unknown>>(raw);
  const outer = (invObj.invitation as Record<string, unknown>) ?? invObj;
  const inner = (outer?.invitation as Record<string, unknown>) ?? outer;
  const rawGroupId =
    inner?.group_id ?? inner?.groupId ?? outer?.group_id ?? outer?.groupId;
  const namespaceId = Array.isArray(rawGroupId)
    ? (rawGroupId as number[])
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
    : String(rawGroupId ?? "");
  if (!namespaceId) return null;

  // The inviter embeds the human team name so the joiner doesn't render a raw ID.
  const teamName =
    typeof invObj.__teamName === "string" ? invObj.__teamName.trim() : "";
  if (teamName) setStoredTeamName(namespaceId, teamName);

  return { namespaceId, invitation: outer, teamName: teamName || undefined };
}

/**
 * An invitation link opened this app.
 *
 * Mounted once, above the routes, so a link opened on any page — the landing
 * page, the editor, the teams list — is offered wherever the person is.
 * Capture is primed in `main.tsx` and buffers the invitation until the session
 * can join, so arriving before login loses nothing. It asks first: joining
 * puts this node into someone else's team, which a forwarded link must not do
 * on its own. Once joined it opens the team, as the teams list would.
 */
export default function InvitationPrompt() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading } = useMero();
  // The session-aware API (see api/useApi): on an account the join redeems
  // through the admitter's route; the raw node route is a 403 there.
  const api = useApi();

  /** The two calls @calimero-apps/invite needs from this app. */
  const redeemer = useMemo(
    () => ({
      join: async (namespaceId: string, invitation: unknown) => {
        await api.admin.joinNamespace(namespaceId, {
          invitation: invitation as SignedGroupOpenInvitation,
        });
      },
      memberships: async () => {
        const items = await api.listNamespaces(await api.ensureAppId());
        return items.map((n) => n.namespaceId ?? "");
      },
    }),
    [api],
  );

  const invite = useInviteRedemption({
    parse: parseTeamInvitation,
    redeemer,
    enabled: isAuthenticated && !isLoading,
    onJoined: (namespaceId) => navigate(`/teams/${namespaceId}/projects`),
  });

  // Landed: the team is on screen now, so the banner hands over to a toast
  // rather than sitting over the page with nothing left to ask.
  const { stage } = invite.state;
  const { dismiss } = invite;
  useEffect(() => {
    if (stage !== "joined" && stage !== "already-member") return;
    showToast(
      stage === "joined"
        ? "Joined team. Syncing artwork…"
        : "You are already in this team.",
      "success",
    );
    dismiss();
  }, [stage, dismiss, showToast]);

  if (stage === "idle") return null;
  return (
    <div
      style={{
        position: "fixed",
        top: "1rem",
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(36rem, calc(100% - 2rem))",
        zIndex: 1000,
        borderRadius: "0.5rem",
        background: "var(--bg-1)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      <InviteStatusBanner
        state={invite.state}
        noun="team"
        onAccept={invite.accept}
        onDecline={invite.decline}
        onRetry={invite.retry}
        onDismiss={invite.dismiss}
      />
    </div>
  );
}
