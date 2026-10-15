import { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  InvitationDialog,
  useInviteRedemption,
  type ParsedInvitation,
  type RedeemOutcome,
} from '@calimero-network/mero-react';
import { useCalimero } from '../lib/useCalimero';
import {
  InvitationRedeemError,
  joinWorkspaceFromInvitation,
  parseInvitation,
  type RedeemStage,
} from '../api/invitationJoin';
import {
  namespaceIdOfInvite,
  type MeroSignInvitePayload,
} from '../lib/inviteCodec';

// ── The invitation prompt ────────────────────────────────────────────────────
//
// Mounted at APP level (see App.tsx), not on a page: an invitation link can land
// on any route — `/`, `/docs`, a deep link the launcher rewrote, a path that
// does not exist — and the prompt has to be there wherever it lands.
//
// It ASKS FIRST. Opening a link is not consent to join: the prompt names what
// the invitation is for and joins only on "Join". It used to start the join
// the moment it mounted, so any page that could get a link opened in your
// browser could put your node into a workspace.
//
// The prompt is mero-react's `InvitationDialog`; the join itself lives in
// `api/invitationJoin.ts`. The dialog stays on "Syncing…" until the page the
// join lands on has read the workspace: AgreementsPage's or AgreementPage's
// `useJoinSync`.

const ASK_COPY =
  'You were invited to a Mero Sign workspace. Joining adds your node to it, ' +
  'and its agreements sync to you.';

// The slow steps after the workspace join, shown under "Joining…". The join
// itself keeps the dialog's own words about waiting for a member.
const STAGE_COPY: Record<RedeemStage, string | null> = {
  joining: null,
  entering:
    'An invitation is to a workspace; this is finding the agreement inside it.',
  syncing:
    'Waiting for the agreement to replicate onto your node. This can take a moment.',
  registering: 'Recording you as a participant so you can sign.',
  naming: 'Saving the agreement to your dashboard.',
};

interface SignInvitation extends ParsedInvitation {
  token: string;
  payload: MeroSignInvitePayload;
}

export default function InvitationHandlerPopup() {
  const { app, isAuthenticated } = useCalimero();
  const navigate = useNavigate();
  const [stage, setStage] = useState<RedeemStage | null>(null);
  // Set for a legacy targeted invitation only. It joins one agreement and no
  // workspace, so no page's `useJoinSync` watches it; the join has already
  // waited for that agreement's state, which is the read the dialog waits on.
  const [legacySynced, setLegacySynced] = useState(false);

  const parse = useCallback((token: string): SignInvitation | null => {
    const payload = parseInvitation(token);
    if (!payload) return null;
    return {
      // A legacy targeted invitation names no workspace; the token stands in
      // so it is still asked about, and `joinWorkspaceFromInvitation` decides
      // what it can redeem.
      namespaceId: namespaceIdOfInvite(payload) || token,
      invitation: payload.invitation,
      // The invitation's own name, so the prompt can say WHAT you are joining.
      // Untrusted, it is outside the signature, and superseded by the
      // contract's name the moment the join completes.
      teamName: payload.contextName || payload.workspaceName,
      token,
      payload,
    };
  }, []);

  const redeem = useCallback(
    async ({ token, teamName }: SignInvitation): Promise<RedeemOutcome> => {
      setLegacySynced(false);
      try {
        const result = await joinWorkspaceFromInvitation(token, app, setStage);
        // ⚠️ An invitation grants membership of a WORKSPACE. It resolves to a
        // single agreement only when the workspace holds exactly one, or when
        // the link named one that is in it. With none or several — both
        // ordinary — the workspace is where the person belongs, and
        // `/agreements/undefined` is where they used to end up.
        if (result.contextId) {
          navigate(`/agreements/${result.contextId}`, { replace: true });
        } else if (result.namespaceId) {
          navigate(`/workspaces/${result.namespaceId}`, { replace: true });
        } else {
          navigate('/workspaces', { replace: true });
        }
        if (!result.namespaceId) setLegacySynced(true);
        return {
          status: 'joined',
          // The workspace the landing page's `useJoinSync` watches.
          namespaceId: result.namespaceId ?? result.contextId ?? token,
          teamName: result.name || result.workspaceName || teamName,
        };
      } catch (error) {
        if (error instanceof InvitationRedeemError) return error.outcome;
        // Everything else is this app's own words about a link it cannot use
        // or a step that broke after the join; worth another try.
        return {
          status: 'failed',
          namespaceId: null,
          message:
            error instanceof Error
              ? error.message
              : 'An unexpected error occurred while joining.',
          reason: 'unknown',
          retryable: true,
        };
      } finally {
        setStage(null);
      }
    },
    [app, navigate],
  );

  const redemption = useInviteRedemption({
    parse,
    redeem,
    // `app` is created asynchronously by the provider; joining without it puts
    // every call on the apiClient fallback path. The invitation is buffered
    // meanwhile, so one opened signed out survives the login.
    enabled: !!isAuthenticated && !!app,
  });

  return (
    <InvitationDialog
      redemption={redemption}
      noun="workspace"
      appName="Mero Sign"
      detail={ASK_COPY}
      status={stage ? STAGE_COPY[stage] : null}
      synced={legacySynced}
    />
  );
}
