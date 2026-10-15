import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  InvitationDialog,
  useInviteRedemption,
  useMero,
  type ParsedInvitation,
} from '@calimero-network/mero-react';
import type { SignedGroupOpenInvitation } from '@calimero-network/mero-js';
import { listNamespaces } from '../../../api/admin';
import { useEnsureAppId } from '../../../hooks/useEnsureAppId';
import { decodeInvitationObject } from '../../../utils/invitation';
import { setStoredTeamName } from '../../../utils/teamName';

type NamespaceRaw = {
  namespaceId?: string;
  groupId?: string;
  id?: string;
};

/** Read a raw invitation token into the parts the join needs. */
function parseTeamInvitation(raw: string): ParsedInvitation | null {
  const invObj = decodeInvitationObject<Record<string, unknown>>(raw);
  const outer = (invObj.invitation as Record<string, unknown>) ?? invObj;
  const inner = (outer?.invitation as Record<string, unknown>) ?? outer;
  const rawGroupId =
    inner?.group_id ?? inner?.groupId ?? outer?.group_id ?? outer?.groupId;
  const namespaceId = Array.isArray(rawGroupId)
    ? (rawGroupId as number[])
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
    : String(rawGroupId ?? '');
  if (!namespaceId) return null;

  const teamName =
    typeof invObj.__teamName === 'string' ? invObj.__teamName.trim() : '';
  if (teamName) setStoredTeamName(namespaceId, teamName);

  return { namespaceId, invitation: outer, teamName: teamName || undefined };
}

/**
 * An invitation link opened this app.
 *
 * Mounted once, above the routes, so a link opened on any page — the landing
 * page, a calendar, the teams list — is offered wherever the person is.
 * Capture is primed in `index.tsx` and buffers the invitation until the
 * session can join, so arriving before login loses nothing. It asks first:
 * joining puts this node into someone else's team, which a forwarded link must
 * not do on its own. Once joined it opens the team's calendars, and the dialog
 * stays on "Syncing…" until that page's `useJoinSync` has read the team's
 * calendar list.
 */
export default function InvitationPrompt() {
  const navigate = useNavigate();
  // `admin`, NOT `mero.admin`: the session-aware one. On an account it redeems
  // the invitation through the admitter's route; the raw client's node route
  // is a 403 there.
  const { admin, isAuthenticated, isLoading } = useMero();
  const ensureAppId = useEnsureAppId();

  const requireAdmin = useCallback(() => {
    if (!admin) throw new Error('Not connected.');
    return admin;
  }, [admin]);

  /** The two calls a standard join needs from this app. */
  const redeemer = useMemo(
    () => ({
      // `join` has to THROW on refusal — the redeemer reads the outcome off the
      // error — so no catch here.
      join: async (namespaceId: string, invitation: unknown) => {
        await requireAdmin().joinNamespace(namespaceId, {
          invitation: invitation as SignedGroupOpenInvitation,
        });
      },
      memberships: async () => {
        const items = await listNamespaces(requireAdmin(), await ensureAppId());
        return (Array.isArray(items) ? items : []).map(
          (n: NamespaceRaw) => n.namespaceId ?? n.groupId ?? n.id ?? '',
        );
      },
    }),
    [ensureAppId, requireAdmin],
  );

  const invite = useInviteRedemption({
    parse: parseTeamInvitation,
    redeemer,
    enabled: isAuthenticated && !isLoading && !!admin,
    onJoined: (namespaceId) => navigate(`/teams/${namespaceId}`),
  });

  return <InvitationDialog redemption={invite} noun="team" appName="Mero Calendar" />;
}
