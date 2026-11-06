import React, { useEffect } from 'react';

import { useSessionApi } from '../sessionContext';
import SignInPanel from './SignInPanel';
import { Overlay, Dialog, Close } from './modalKit';

/** The landing page's sign-in popup. Its body is `SignInPanel`, shared with the invitation page. */
export default function SignInModal({ onClose }: { onClose: () => void }): React.ReactElement {
  const { api } = useSessionApi();

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
        <SignInPanel titleId="signin-title" />
      </Dialog>
    </Overlay>
  );
}
