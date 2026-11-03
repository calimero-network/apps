import { useState } from 'react';
import { Input } from '@calimero-network/mero-ui';

import type { SessionApi } from '../session';

/**
 * Passkey sign-in, or a new account with a new passkey. Replaces v1's node
 * login popup: where the app connects is fixed by the build (merod local in
 * development, a Calimero Cloud cluster in production), so there is no node
 * to pick.
 */
export default function ConnectCard({ api, where }: { api: SessionApi; where: string }) {
  const [name, setName] = useState('');
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
        <div>
          <button type="button" className="btn-deploy" disabled={api.busy} onClick={() => void api.signIn()}>
            Sign in with a passkey
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void api.signUp(name.trim());
          }}
          style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}
        >
          <div style={{ flex: 1, minWidth: '160px' }}>
            <Input
              type="text"
              placeholder="Your name"
              aria-label="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <button type="submit" className="btn-ghost" disabled={api.busy || !name.trim()}>
            Create an account
          </button>
        </form>
        {api.error && (
          <div className="lobby-banner-error" role="alert">
            <span className="lobby-banner-error-glyph" aria-hidden>!</span>
            <span>{api.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
