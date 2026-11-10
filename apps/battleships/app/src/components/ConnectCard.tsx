import { PasskeySignIn, usePendingInvite } from '@calimero-apps/passkey';
import '@calimero-apps/passkey/passkey.css';

import { useInviteState, type SessionApi } from '../session';

/**
 * Passkey sign-in, or a new account with a new passkey. Replaces v1's node
 * login popup: where the app connects is fixed by the build (merod local in
 * development, a Calimero Cloud cluster in production), so there is no node
 * to pick.
 *
 * With an invitation link pending it is the invitation: what the visitor was
 * invited to, then creating an account and joining in one click (or joining
 * with a passkey this browser has used here). `onNotNow` (the invitation page)
 * offers the way back to the landing page, keeping the token.
 */
export default function ConnectCard({
  api,
  where,
  onNotNow,
}: {
  api: SessionApi;
  where: string;
  onNotNow?: () => void;
}) {
  const invited = usePendingInvite(useInviteState().invites) !== null;
  return (
    <div className="naval-card fade-in" data-testid={invited ? 'invitation-card' : 'connect-card'}>
      <div className="naval-card-header">
        <div className="naval-card-title">{invited ? "You're invited" : 'Sign in to play'}</div>
        <div className="naval-card-subtitle">{where}</div>
      </div>
      <div className="naval-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {invited && (
          <span className="mono-sm" data-testid="invitation-note">
            You&apos;ve been invited to join the lobby in Battleships.
          </span>
        )}
        <span className="mono-sm">
          Accounts are passkeys: nothing to remember, nothing to leak. Your fleet stays in this
          browser; the contract only ever sees its commitment.
        </span>
        <div style={{ maxWidth: '360px' }}>
          <PasskeySignIn api={api} joining="the lobby" invited={invited} />
        </div>
        {onNotNow && (
          <div>
            <button type="button" className="btn-ghost" onClick={onNotNow} data-testid="invitation-not-now">
              Not now
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
