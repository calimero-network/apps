import React, { useEffect, useState } from 'react';

import { describeTarget } from '../session';
import { useSessionApi } from '../sessionContext';
import { pendingInvite } from '../workspaces';
import { Overlay, Dialog, Close, Field, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin } from './modalKit';

/**
 * Sign in with a passkey, or create an account with a new one. Replaces v1's
 * node connect dialog (local node discovery, a node URL, the Cloud wallet):
 * on Calimero 1.0 the frontend already knows its cluster (local nodes in dev,
 * the Cloud cluster in production) and the account is a passkey.
 */
export default function SignInModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const { api } = useSessionApi();
  const [name, setName] = useState('');
  const invited = pendingInvite() !== null;

  useEffect(() => {
    if (api.session.status === 'signed-in') onClose();
  }, [api.session.status, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !api.busy) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [api.busy, onClose]);

  const where =
    api.session.status === 'signed-out' || api.session.status === 'signed-in'
      ? describeTarget(api.session.target)
      : null;

  return (
    <Overlay onClick={() => !api.busy && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="signin-title">
        <Close onClick={() => !api.busy && onClose()} aria-label="Close">×</Close>
        <h3 id="signin-title">{invited ? "You're invited" : 'Sign in'}</h3>
        <p className="sub">
          {invited
            ? 'Sign in, or create an account, to join the workspace you were invited to. '
            : ''}
          Accounts are passkeys: nothing to remember, nothing to leak.
          {where ? ` Connected to ${where}.` : ''}
        </p>

        {api.session.status === 'connecting' && <p className="sub">Connecting…</p>}
        {api.session.status === 'unconfigured' && <ErrorLine>{api.session.message}</ErrorLine>}

        {api.session.status === 'signed-out' && (
          <>
            <Actions style={{ justifyContent: 'stretch' }}>
              <PrimaryBtn
                data-testid="signin-passkey"
                style={{ width: '100%' }}
                disabled={api.busy}
                onClick={() => void api.signIn()}
              >
                {api.busy ? <Spin /> : 'Sign in with a passkey'}
              </PrimaryBtn>
            </Actions>
            <Field style={{ marginTop: 22 }}>
              <label htmlFor="signup-name">New here? Your name</label>
              <input
                id="signup-name"
                data-testid="signup-name"
                value={name}
                maxLength={64}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void api.signUp(name.trim()); }}
                disabled={api.busy}
              />
            </Field>
            <Actions>
              <SecondaryBtn
                data-testid="signup-passkey"
                disabled={api.busy || !name.trim()}
                onClick={() => void api.signUp(name.trim())}
              >
                Create an account
              </SecondaryBtn>
            </Actions>
          </>
        )}

        {api.error && <ErrorLine>{api.error}</ErrorLine>}
      </Dialog>
    </Overlay>
  );
}
