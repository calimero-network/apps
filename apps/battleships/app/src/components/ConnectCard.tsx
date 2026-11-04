import { PasskeySignIn } from '@calimero-apps/passkey';
import '@calimero-apps/passkey/passkey.css';

import type { SessionApi } from '../session';

/**
 * Passkey sign-in, or a new account with a new passkey. Replaces v1's node
 * login popup: where the app connects is fixed by the build (merod local in
 * development, a Calimero Cloud cluster in production), so there is no node
 * to pick.
 */
export default function ConnectCard({ api, where }: { api: SessionApi; where: string }) {
  return (
    <div className="naval-card fade-in" data-testid="connect-card">
      <div className="naval-card-header">
        <div className="naval-card-title">Sign in to play</div>
        <div className="naval-card-subtitle">{where}</div>
      </div>
      <div className="naval-card-body" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <span className="mono-sm">
          Accounts are passkeys: nothing to remember, nothing to leak. Your fleet stays in this
          browser; the contract only ever sees its commitment.
        </span>
        <div style={{ maxWidth: '360px' }}>
          <PasskeySignIn api={api} />
        </div>
      </div>
    </div>
  );
}
