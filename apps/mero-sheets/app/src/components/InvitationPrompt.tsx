/**
 * "Join this workspace?" for an invitation that arrived as a link (`?invite=`,
 * taken into storage before the first render: see `captureInvite`).
 *
 * Mounted at the APP level because a link can land on any route, and it asks
 * rather than joins: joining puts you in someone's organization, and a
 * forwarded link or a refreshing background tab should not do that silently.
 *
 * Signed out, it offers the sign-in first; the token survives the sign-up.
 * Signed in, Join redeems the org invite and reports what to open: the
 * spreadsheet the link names, or the workspace's list. There is no
 * "Syncing…" stage any more: nothing has to replicate before a new member can
 * read.
 */
import { useCallback, useState } from 'react';
import { CalimeroError } from '@calimero-network/mero-js';
import { APP_DISPLAY_NAME } from '../config';
import { describeError } from '../utils/errors';
import { useMaybeSignedIn, useSessionApi } from '../sessionContext';
import { dropInvite, joinedOrg, pendingInvite, type AcceptedInvite, type PendingInvite } from '../lib/workspaces';
import SignInModal, { Dialog, Err, Hint, Overlay, Primary, Secondary } from './SignInModal';

export default function InvitationPrompt({ onJoined }: { onJoined: (landed: AcceptedInvite) => void }) {
  const { api } = useSessionApi();
  const signedIn = useMaybeSignedIn();
  const [invite, setInvite] = useState<PendingInvite | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const ready = api.session.status === 'signed-out' || api.session.status === 'signed-in';

  const dismiss = useCallback(() => {
    dropInvite();
    setInvite(null);
    setError(null);
  }, []);

  const join = useCallback(async () => {
    if (!signedIn || !invite) return;
    setBusy(true);
    setError(null);
    try {
      const org = joinedOrg(await signedIn.client.redeemInvite(invite.token));
      dropInvite();
      setInvite(null);
      onJoined({ namespaceId: org, contextId: invite.sheet });
    } catch (e) {
      // A refusal (used, expired, revoked) can never succeed: drop it. Anything
      // else (the cluster unreachable) is kept for another try.
      if (e instanceof CalimeroError && e.status < 500) dropInvite();
      setError(`The invitation could not be accepted: ${describeError(e)}`);
    } finally {
      setBusy(false);
      signedIn.after();
    }
  }, [signedIn, invite, onJoined]);

  if (!invite || !ready) return null;
  if (signingIn && !signedIn) return <SignInModal open onClose={() => setSigningIn(false)} />;

  return (
    <Overlay>
      <Dialog role="dialog" aria-modal="true" aria-labelledby="invitation-title" data-testid="invitation-dialog">
        <h3 id="invitation-title">You&apos;re invited to {APP_DISPLAY_NAME}</h3>
        <Hint>
          {invite.sheet
            ? 'Joining gives you the workspace and takes you straight into the spreadsheet you were invited to.'
            : 'Joining gives you the workspace and every spreadsheet in it.'}
        </Hint>
        {error && (
          <Err role="alert" data-testid="invitation-error">
            {error}
          </Err>
        )}
        {signedIn ? (
          <Primary type="button" onClick={() => void join()} disabled={busy} data-testid="invitation-join">
            {busy ? 'Joining…' : 'Join'}
          </Primary>
        ) : (
          <Primary type="button" onClick={() => setSigningIn(true)} data-testid="invitation-signin">
            Sign in to join
          </Primary>
        )}
        <Secondary type="button" onClick={dismiss} disabled={busy} data-testid="invitation-dismiss">
          Not now
        </Secondary>
      </Dialog>
    </Overlay>
  );
}
