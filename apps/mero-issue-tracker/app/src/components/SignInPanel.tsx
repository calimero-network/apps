import React from 'react';
import { AppListing, PasskeySignIn } from '@calimero-apps/passkey';
import '@calimero-apps/passkey/passkey.css';

import { PRODUCT_NAME } from '../config';
import { LISTING, describeTarget } from '../session';
import { useSessionApi } from '../sessionContext';
import { pendingInvite } from '../workspaces';
import { ErrorLine } from './modalKit';

/**
 * Sign in with a passkey, or create an account with a new one: the body both
 * the sign-in popup and the invitation page render, so the copy and the
 * passkey flow are the same wherever a visitor starts.
 *
 * Replaces v1's node connect dialog (local node discovery, a node URL, the
 * Cloud wallet): on Calimero 1.0 the frontend already knows its cluster (local
 * nodes in dev, the Cloud cluster in production) and the account is a passkey.
 */
export default function SignInPanel({ titleId }: { titleId: string }): React.ReactElement {
  const { api } = useSessionApi();
  const invited = pendingInvite() !== null;

  const where =
    api.session.status === 'signed-out' || api.session.status === 'signed-in'
      ? describeTarget(api.session.target)
      : null;

  return (
    <>
      <h3 id={titleId}>{invited ? "You're invited" : 'Sign in or create an account'}</h3>
      <p className="sub">
        {invited
          ? `You've been invited to join a workspace in ${PRODUCT_NAME}. Sign in or create an account to accept. `
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
