import { AppListing, PasskeySignIn } from '@calimero-apps/passkey';
import '@calimero-apps/passkey/passkey.css';

import { LISTING, useCalimero } from '../calimero';
import { pendingInvite } from '../lib/inviteLink';
import shell from '../styles/shell.module.css';

/**
 * Sign in with a passkey, or make an account with a new one: the body both
 * the sign-in dialog and the invitation page render, so the copy and the
 * passkey flow are the same wherever a visitor starts. There is no node URL to
 * type: the app connects to merod local in development and to its Calimero
 * Cloud cluster in production.
 */
export default function SignInPanel() {
  const api = useCalimero();
  const invited = pendingInvite() !== null;

  if (api.status === 'listing') return <AppListing {...LISTING} />;
  if (api.status === 'unconfigured') {
    return (
      <p className={shell.error} data-testid="sign-in-unconfigured">
        {api.message}
      </p>
    );
  }
  return (
    <>
      <p className={shell.sectionHint}>
        {invited
          ? "You've been invited to join a team in Mero Pass. Sign in or create an account to accept. "
          : ''}
        {api.where ? `Connected to ${api.where}. ` : 'Connecting… '}
        Your account is a passkey: nothing to remember, nothing to leak.
      </p>
      {api.status === 'signed-out' && <PasskeySignIn api={api} askName />}
    </>
  );
}
