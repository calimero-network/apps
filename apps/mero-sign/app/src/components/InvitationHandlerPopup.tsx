import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { describeError } from '@calimero-apps/connect';
import GlassDialog from './ui/GlassDialog';
import { useCalimero } from '../lib/useCalimero';
import {
  enterAgreement,
  isFinalRefusal,
  joinedOrg,
  listAgreements,
  pickInvitedAgreement,
} from '../lib/agreements';
import { dropInvite, pendingInvite, type PendingInvite } from '../lib/inviteLink';
import { setActiveWorkspace } from '../lib/activeWorkspace';
import styles from '../pages/app/AgreementsPage.module.css';

/**
 * An invitation link opened before (or after) signing in: asks, then redeems
 * the org invite and lands in the workspace, or in the agreement the inviter
 * shared when it is in that workspace. Mounted above the routes, so a link can
 * land on any page; it waits for a session before it asks.
 */
export default function InvitationHandlerPopup() {
  const { app, isAuthenticated, login } = useCalimero();
  const navigate = useNavigate();
  const [invite, setInvite] = useState<PendingInvite | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signed out with a link in hand: open the sign-in, the invitation waits.
  useEffect(() => {
    if (invite && !isAuthenticated) login();
  }, [invite, isAuthenticated, login]);

  const decline = useCallback(() => {
    dropInvite();
    setInvite(null);
    setError(null);
  }, []);

  const accept = useCallback(async () => {
    if (!app || !invite) return;
    setBusy(true);
    setError(null);
    try {
      const org = joinedOrg(await app.client.redeemInvite(invite.token));
      app.after();
      dropInvite();
      setInvite(null);
      if (!org) {
        navigate('/workspaces', { replace: true });
        return;
      }
      setActiveWorkspace(org);
      const agreements = await listAgreements(app, org).catch(() => []);
      const target = pickInvitedAgreement(agreements, invite.agreement);
      if (target?.contextId) {
        await enterAgreement(app, { contextId: target.contextId });
        navigate(`/agreements/${target.contextId}`, { replace: true });
      } else {
        navigate(`/workspaces/${org}`, { replace: true });
      }
    } catch (e) {
      if (isFinalRefusal(e)) dropInvite();
      setError(`The invitation could not be accepted: ${describeError(e)}`);
    } finally {
      setBusy(false);
    }
  }, [app, invite, navigate]);

  return (
    <GlassDialog
      open={!!invite && isAuthenticated}
      onClose={decline}
      title="Join a workspace?"
      description="You were invited to a Mero Sign workspace: the people you sign with, and the agreements you sign with them."
      testId="invitation-dialog"
      footer={
        <div className={styles.modalRow}>
          <button type="button" className={styles.btnGhost} onClick={decline} disabled={busy}>
            Not now
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void accept()}
            disabled={busy}
            data-testid="accept-invitation"
          >
            {busy ? 'Joining…' : 'Join'}
          </button>
        </div>
      }
    >
      {error && <p className={styles.error}>{error}</p>}
    </GlassDialog>
  );
}
