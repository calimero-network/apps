import { PasskeySignIn } from '@calimero-apps/passkey';
import '@calimero-apps/passkey/passkey.css';

import type { SessionApi } from '../session';
import { pendingInvite } from '../lobbies';

/**
 * Passkey sign-in, or a new account with a new passkey. Replaces v1's node
 * login popup: where the app connects is fixed by the build (merod local in
 * development, a Calimero Cloud cluster in production), so there is no node
 * to pick.
 *
 * With an invitation link pending it is the invitation: what the visitor was
 * invited to, then the same passkey buttons. `onNotNow` (the invitation page)
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
  const invited = pendingInvite() !== null;
  return (
    <div className="naval-card fade-in" data-testid={invited ? 'invitation-card' : 'connect-card'}>
      <div className="naval-card-header">
        <div className="naval-card-title">{invited ? "You're invited" : 'Sign in to play'}</div>
        <div className="naval-card-subtitle">{where}</div>
      </div>
      <div className="naval-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {invited && (
          <span className="mono-sm" data-testid="invitation-note">
            You&apos;ve been invited to join a lobby in Battleships. Sign in or create an account to accept.
          </span>
        )}
        <span className="mono-sm">
          Accounts are passkeys: nothing to remember, nothing to leak. Your fleet stays in this
          browser; the contract only ever sees its commitment.
        </span>
        <div style={{ maxWidth: '360px' }}>
          <PasskeySignIn api={api} />
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
