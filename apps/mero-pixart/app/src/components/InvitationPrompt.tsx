import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import type { SignedGroupOpenInvitation } from "@calimero-apps/cloud";
import {
  InvitationDialog,
  InvitationGate,
  useInviteRedemption,
  useMero,
  type ParsedInvitation,
} from "@calimero-apps/cloud";
import { useApi } from "../api/useApi";
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
 * An invitation link opened this app: mero-react's `InvitationDialog`.
 *
 * Mounted once, above the routes, so a link opened on any page — the landing
 * page, the editor, the teams list — is offered wherever the person is.
 * Capture is primed in `main.tsx` and buffers the invitation until the session
 * can join, so arriving before login loses nothing. It asks first: joining
 * puts this node into someone else's team, which a forwarded link must not do
 * on its own. Once joined it opens the team, as the teams list would, and
 * stays on "Syncing…" until ProjectsPage's `useJoinSync` sees the team's
 * project list come back from the node.
 */
export default function InvitationPrompt() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useMero();
  // The session-aware API (see api/useApi): on an account the join redeems
  // through the admitter's route; the raw node route is a 403 there.
  const api = useApi();

  /** The two calls the standard join needs from this app. */
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

  const redemption = useInviteRedemption({
    parse: parseTeamInvitation,
    redeemer,
    enabled: isAuthenticated && !isLoading,
    onJoined: (namespaceId) => navigate(`/teams/${namespaceId}/projects`),
  });

  return (
    <>
      {/* Logged out with a link opened: "you're invited" and the login, not the landing page. */}
      <InvitationGate parse={parseTeamInvitation} noun="team" appName="Mero PixArt" />
      <InvitationDialog redemption={redemption} noun="team" appName="Mero PixArt" />
    </>
  );
}
