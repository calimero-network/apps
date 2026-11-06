import React from 'react';
import { AppListing, PasskeySignIn } from '@calimero-apps/passkey';
import '@calimero-apps/passkey/passkey.css';

import { PRODUCT_NAME } from '../config';
import { LISTING, describeTarget } from '../session';
import { useSessionApi } from '../sessionContext';
import { ErrorLine } from './modalKit';

/**
 * The sign-in content: one passkey screen that both signs in and creates an
 * account. Shared by the popup (`SignInModal`) and the invitation page a
 * signed-out invite link lands on (`InvitationPage`), so the copy and the
 * passkey flow cannot drift apart.
 */
export default function SignInPanel({ invited, titleId }: { invited: boolean; titleId: string }): React.ReactElement {
  const { api } = useSessionApi();
  const where =
    api.session.status === 'signed-out' || api.session.status === 'signed-in'
      ? describeTarget(api.session.target)
      : null;

  return (
    <>
      <h3 id={titleId}>{invited ? "You're invited" : 'Sign in or create an account'}</h3>
      <p className="sub">
        {invited
          ? `You've been invited to join a workspace in ${PRODUCT_NAME}. Sign in, or create an account, to accept. `
          : ''}
        Accounts are passkeys: nothing to remember, nothing to leak.
        {where ? ` Connected to ${where}.` : ''}
      </p>

      {api.session.status === 'connecting' && <p className="sub">Connecting…</p>}
      {api.session.status === 'listing' && <AppListing {...LISTING} />}
      {api.session.status === 'unconfigured' && <ErrorLine>{api.session.message}</ErrorLine>}

      {api.session.status === 'signed-out' && <PasskeySignIn api={api} />}
    </>
  );
}
