import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMero } from "@calimero-network/mero-react";
import {
  InviteStatusBanner,
  useInviteRedemption,
  type ParsedInvitation,
} from "@calimero-apps/invite";
import { joinNamespace, listNamespaces } from "../api/rpc";
import { useApplicationId } from "../hooks/useApplicationId";
import { useToast } from "../contexts/ToastContext";
import { decodeInvitationObject } from "../utils/invitation";
import { setStoredTeamName } from "../utils/teamName";

/**
 * Read a raw invitation token into the parts the join needs.
 *
 * Invitation shape:
 *   { invitation: { invitation: { group_id: [...] }, inviterSignature,
 *     applicationId }, __teamName? }
 * The join body must wrap the invitation struct (`outer`), NOT the whole
 * decoded token.
 */
function parseTeamInvitation(raw: string): ParsedInvitation | null {
  // Use the shared UTF-8-safe decoder so a Unicode __teamName (emoji,
  // accents) round-trips correctly.
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
 * page, a board, the teams list — is offered wherever the person is. Capture
 * is primed in `main.tsx` and buffers the invitation until the session can
 * join, so arriving before login loses nothing. It asks first: joining puts
 * this node into someone else's team, which a forwarded link must not do on
 * its own. Once joined it opens the team, as the teams list would.
 */
export default function InvitationPrompt() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { isAuthenticated, isLoading } = useMero();
  const ensureAppId = useApplicationId();

  /** The two calls @calimero-apps/invite needs from this app. */
  const redeemer = useMemo(
    () => ({
      join: async (namespaceId: string, invitation: unknown) => {
        await joinNamespace(namespaceId, invitation);
      },
      memberships: async () => {
        const items = await listNamespaces(await ensureAppId());
        return items.map((n) => n.namespaceId);
      },
    }),
    [ensureAppId],
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
        ? "Joined team. Syncing projects…"
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
        background: "var(--glass-surface-solid, var(--color-bg))",
        boxShadow: "var(--md-lift)",
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
