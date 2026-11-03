import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCalimero } from '../calimero';
import { describeError } from '../lib/errors';
import { dropInvite, pendingInvite } from '../lib/inviteLink';
import { destinationFor } from '../lib/redeemFlow';
import { redeemInvite } from '../lib/vaults';
import shell from '../styles/shell.module.css';

/**
 * "Join this team?" for an invitation that arrived as a link.
 *
 * Mounted at the app level: a link can land on any path. It asks rather than
 * joins (joining puts you in someone else's team), and it waits for a session:
 * a person opening a link signs in or up first, and the token, captured off the
 * address bar before React mounted (`captureInvite`), survives that.
 */
export default function InvitationPrompt() {
  const { client, isAuthenticated, after } = useCalimero();
  const navigate = useNavigate();
  const [token, setToken] = useState<string | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) setToken(pendingInvite());
  }, [isAuthenticated]);

  const join = useCallback(async () => {
    if (!client || !token) return;
    setBusy(true);
    setError(null);
    try {
      const landed = await redeemInvite({ client, after }, token);
      dropInvite();
      setToken(null);
      navigate(destinationFor(landed));
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  }, [client, token, after, navigate]);

  const dismiss = useCallback(() => {
    dropInvite();
    setToken(null);
  }, []);

  if (!token || !isAuthenticated) return null;
  return (
    <div
      className={shell.panel}
      role="dialog"
      aria-label="Invitation"
      data-testid="invitation-prompt"
    >
      <p className={shell.panelTitle}>You have been invited to a team</p>
      <p className={shell.panelSub}>
        Joining gives you access to the team and every vault in it that is not
        invite-only, plus any invite-only vault the invitation names. Your
        devices get each vault’s key once a member who holds it opens the vault.
      </p>
      {error && (
        <p className={shell.error} data-testid="invitation-error">
          {error}
        </p>
      )}
      <div className={shell.createRow}>
        <button
          type="button"
          className={shell.btn}
          onClick={() => void join()}
          disabled={busy}
          data-testid="invitation-join"
        >
          {busy ? 'Joining…' : 'Join'}
        </button>
        <button
          type="button"
          className={shell.btnGhost}
          onClick={dismiss}
          disabled={busy}
          data-testid="invitation-dismiss"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
