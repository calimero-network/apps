import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useCalimero } from '../calimero';
import {
  SPENT_INVITE_COPY,
  describeRedeemFailure,
  isSpentInvite,
  memberOf,
} from '@calimero-apps/connect';
import { usePendingInvite } from '@calimero-apps/passkey';

import { invites, signInTitle, takeJoinedAtSignUp } from '../lib/inviteLink';
import { destinationFor } from '../lib/redeemFlow';
import { redeemInvite } from '../lib/vaults';
import gate from '../styles/gate.module.css';
import shell from '../styles/shell.module.css';
import SignInPanel from './SignInPanel';

/** What the page says once the invitation can no longer be accepted. */
type Outcome = { kind: 'member'; org: string } | { kind: 'spent' };

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
 * Redeeming spends a use even for someone already in the team, so a link that
 * names its team is checked against the account's teams first and a member is
 * told so instead. A spent invitation (used, expired, revoked) is said plainly.
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
    after,
  } = useCalimero();
  const navigate = useNavigate();
  const pending = usePendingInvite(invites);
  const token = pending?.token ?? null;
  const [deferred, setDeferred] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // Signed up from a page holding the invite: already joined; open the team.
  useEffect(() => {
    if (!isAuthenticated || !client) return;
    const joined = takeJoinedAtSignUp();
    if (joined) navigate(joined.org ? `/teams/${joined.org}` : '/teams');
  }, [isAuthenticated, client, navigate]);

  useEffect(() => {
    const org = invites.pending()?.org;
    if (!isAuthenticated || !client || !token || !org) return;
    let live = true;
    setChecking(true);
    // Unknown membership (`null`): ask, as for a link that names no team.
    void memberOf(client, org)
      .then((member) => {
        if (!live || !member) return;
        invites.drop();
        setOutcome({ kind: 'member', org });
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
      setChecking(false);
    };
  }, [isAuthenticated, client, token]);

  const join = useCallback(async () => {
    if (!client || !token) return;
    setBusy(true);
    setError(null);
    try {
      const landed = await redeemInvite({ client, after }, token);
      invites.drop();
      navigate(destinationFor(landed));
    } catch (e) {
      // Only the node's word that the invite is done drops it: a lapsed
      // session, a rate limit or the cluster unreachable keeps it to try again.
      if (isSpentInvite(e)) {
        invites.drop();
        setOutcome({ kind: 'spent' });
      } else {
        setError(describeRedeemFailure(e));
      }
    } finally {
      setBusy(false);
    }
  }, [client, token, after, navigate]);

  const dismiss = useCallback(() => invites.drop(), []);

  if (outcome) {
    const done = () => {
      setOutcome(null);
      if (outcome.kind === 'member') navigate(`/teams/${outcome.org}`);
    };
    return (
      <main className={gate.gate} data-testid="invitation-outcome">
        <div className={gate.card}>
          <h2 className={gate.title}>
            {outcome.kind === 'member'
              ? "You're already in this team"
              : 'This invite cannot be used'}
          </h2>
          <p className={gate.hint}>
            {outcome.kind === 'member'
              ? 'The invitation was for a team you are already a member of, so there is nothing to accept. It is still unused for the person it was meant for.'
              : SPENT_INVITE_COPY}
          </p>
          <div className={gate.form}>
            <button
              type="button"
              className={`${shell.btn} ${gate.unlock}`}
              onClick={done}
              data-testid="invitation-continue"
            >
              {outcome.kind === 'member' ? 'Open the team' : 'Continue'}
            </button>
          </div>
        </div>
      </main>
    );
  }

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

  return (
    <main className={gate.gate} data-testid="invitation-prompt">
      <div className={gate.card}>
        <h2 className={gate.title}>Join this team?</h2>
        <p className={gate.hint}>
          You have been invited to a team. Joining gives you access to the team
          and every vault in it that is not invite-only, plus any invite-only
          vault the invitation names. Your devices get each vault’s key once a
          member who holds it opens the vault.
        </p>
        {error && (
          <p className={shell.error} data-testid="invitation-error">
            {error}
          </p>
        )}
        <div className={gate.form}>
          <button
            type="button"
            className={`${shell.btn} ${gate.unlock}`}
            onClick={() => void join()}
            disabled={busy || checking}
            data-testid="invitation-join"
          >
            {busy
              ? 'Joining…'
              : checking
                ? 'Checking…'
                : error
                  ? 'Try again'
                  : 'Join'}
          </button>
          <button
            type="button"
            className={shell.btnGhost}
            onClick={dismiss}
            disabled={busy}
            data-testid="invitation-dismiss"
          >
            Not now
          </button>
        </div>
      </div>
    </main>
  );
}
