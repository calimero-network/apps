import React, { useEffect } from 'react';

import { useSessionApi } from '../sessionContext';
import { pendingInvite } from '../workspaces';
import SignInPanel from './SignInPanel';
import { Overlay, Dialog, Close } from './modalKit';

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

  return (
    <Overlay onClick={() => !api.busy && onClose()}>
      <Dialog onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="signin-title">
        <Close onClick={() => !api.busy && onClose()} aria-label="Close">×</Close>
        <SignInPanel invited={invited} titleId="signin-title" />
      </Dialog>
    </Overlay>
  );
}
