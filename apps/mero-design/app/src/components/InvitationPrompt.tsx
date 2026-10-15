import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  InvitationDialog,
  useInviteRedemption,
  useMero,
  type ParsedInvitation,
} from "@calimero-network/mero-react";
import { joinNamespace, listNamespaces } from "../api/rpc";
import { useApplicationId } from "../hooks/useApplicationId";
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
 * An invitation link opened this app: mero-react's `InvitationDialog`.
 *
 * Mounted once, above the routes, so a link opened on any page — the landing
 * page, a board, a team's home — is offered wherever the person is. Capture
 * is primed in `main.tsx` and buffers the invitation until the session can
 * join, so arriving before login loses nothing. It asks first: joining puts
 * this node into someone else's team, which a forwarded link must not do on
 * its own. Once joined it opens the team, as the team switcher would, and stays
 * on "Syncing…" until the shell's `useJoinSync` (DesignShell) sees the team's
 * board list come back from the node.
 */
export default function InvitationPrompt() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useMero();
  const ensureAppId = useApplicationId();

  /** The two calls the standard join needs from this app. */
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

  const redemption = useInviteRedemption({
    parse: parseTeamInvitation,
    redeemer,
    enabled: isAuthenticated && !isLoading,
    onJoined: (namespaceId) => navigate(`/teams/${namespaceId}/projects`),
  });

  return <InvitationDialog redemption={redemption} noun="team" appName="Mero Design" />;
}
