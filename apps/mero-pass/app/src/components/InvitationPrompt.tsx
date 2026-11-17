import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCalimero } from '../calimero';
import { isSpentInvite } from '@calimero-apps/connect';
import { AcceptInviteDialog } from '@calimero-network/mero-react';
import { usePendingInvite } from '@calimero-apps/passkey';

import { invites, signInTitle, takeJoinedAtSignUp } from '../lib/inviteLink';
import { destinationFor } from '../lib/redeemFlow';
import { joinedTeam } from '../lib/vaults';
import gate from '../styles/gate.module.css';
import SignInPanel from './SignInPanel';

/**
 * The invitation screens, wrapped around the routes: a link can land on any
 * path, and the token was captured off the address bar before React mounted
 * (`captureInvite`), so it survives a sign-up. While it is pending the visitor
 * sees a page about the invitation instead of the route:
 *
 *  - signed out: "You're invited", with the same passkey sign-in and sign-up
 *    as the landing page's dialog. "Not now" shows the app as usual and keeps
 *    the token, so signing in later still asks.
 *  - signed in: "Join this team?" straight away. It asks rather than joins
 *    (joining puts you in someone else's team).
 *
 * The asking is the shared `AcceptInviteDialog`: it tells a member of the
 * link's team so without redeeming (a redeem spends a use), and says the
 * node's own refusal for a spent invitation (used, expired, revoked).
 */
export default function InvitationPrompt({
  children,
}: {
  children: ReactNode;
}) {
  const {
    client,
    isAuthenticated,
    isLoading,
    busy: signingIn,
    passkey,
    after,
  } = useCalimero();
  const navigate = useNavigate();
  const pending = usePendingInvite(invites);
  const token = pending?.token ?? null;
  const [deferred, setDeferred] = useState(false);

  // Signed up from a page holding the invite: already joined; open the team.
  useEffect(() => {
    if (!isAuthenticated || !client) return;
    const joined = takeJoinedAtSignUp();
    if (joined) navigate(joined.org ? `/teams/${joined.org}` : '/teams');
  }, [isAuthenticated, client, navigate]);

  const joined = useCallback(
    async ({ org }: { org: string }) => {
      if (!client) return;
      await joinedTeam({ client, after }, org);
      invites.drop();
      navigate(destinationFor({ kind: 'team', namespaceId: org }));
    },
    [client, after, navigate],
  );

  const dismiss = useCallback(() => invites.drop(), []);

  if (!token) return <>{children}</>;
  if (isLoading) return null;

  if (!isAuthenticated) {
    if (deferred) return <>{children}</>;
    return (
      <main className={gate.gate} data-testid="invitation-page">
        <div className={gate.card}>
          <h2 className={gate.title}>{signInTitle()}</h2>
          <div className={gate.panel}>
            <SignInPanel />
          </div>
          <button
            type="button"
            className={gate.link}
            onClick={() => setDeferred(true)}
            disabled={signingIn}
            data-testid="invitation-later"
          >
            Not now
          </button>
        </div>
      </main>
    );
  }

  if (!client) return null;
  return (
    <AcceptInviteDialog
      open
      client={client}
      passkey={passkey()}
      token={token}
      org={pending?.org ?? undefined}
      appName="Hyperfeed Pass"
      labels={{ noun: 'team' }}
      onClose={dismiss}
      onError={(e) => {
        if (isSpentInvite(e)) invites.drop();
      }}
      onJoined={(j) => void joined(j)}
    />
  );
}
