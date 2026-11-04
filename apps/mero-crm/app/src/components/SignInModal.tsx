import React, { useEffect } from 'react';
import { AppListing, PasskeySignIn } from '@calimero-apps/passkey';
import '@calimero-apps/passkey/passkey.css';

import { LISTING, describeTarget } from '../session';
import { useSessionApi } from '../sessionContext';
import { pendingInvite } from '../workspaces';
import { Overlay, Dialog, Close, ErrorLine } from './modalKit';

/**
 * Sign in with a passkey, or create an account with a new one. Replaces v1's
 * node connect dialog (local node discovery, a node URL, the Cloud wallet):
 * on Calimero 1.0 the frontend already knows its cluster (local nodes in dev,
 * the Cloud cluster in production) and the account is a passkey.
 */
export default function SignInModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const { api } = useSessionApi();
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
        {api.session.status === 'listing' && <AppListing {...LISTING} />}
        {api.session.status === 'unconfigured' && <ErrorLine>{api.session.message}</ErrorLine>}

        {api.session.status === 'signed-out' && <PasskeySignIn api={api} />}
      </Dialog>
    </Overlay>
  );
}
