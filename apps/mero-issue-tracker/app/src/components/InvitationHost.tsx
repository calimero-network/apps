import React, { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { describeError } from '@calimero-apps/connect';

import { PRODUCT_NAME } from '../config';
import { useSessionApi } from '../sessionContext';
import { announceJoined } from '../hooks/workspacePersistence';
import {
  SPENT_INVITE,
  dropInvite,
  isSpentInvite,
  joinedOrg,
  listWorkspaces,
  pendingInvite,
  pendingInviteOrg,
  pendingInviteRoute,
} from '../workspaces';
import SignInPanel from './SignInPanel';
import { Page, Card, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin, TextLink } from './modalKit';

/** What the screen says once the invitation can no longer be accepted. */
type Outcome = { kind: 'member'; org: string; route: string } | { kind: 'spent' };

/**
 * The invitation screens, wrapped around the routes because a link can land on
 * any of them. `index.tsx` took `?invite=` into storage before React mounted,
 * so the token survives a sign-up. While it is pending the visitor sees a page
 * about the invitation instead of the route:
 *
 *  - signed out: "You're invited", with the same passkey sign-in and sign-up
 *    as the landing page's popup. "Not now" shows the app as usual and keeps
 *    the token, so signing in later still asks.
 *  - signed in: "Join the workspace?" straight away. The org invite is
 *    redeemed only on the click, as v1 joined only on the click, and joining
 *    goes to the route the link opened (e.g. `/issue-tracker/board`).
 *
 * Redeeming spends one of the invite's uses even for someone already in the
 * org, so a link that names its org is checked against the account's orgs
 * first, and a member is told so instead of being asked. A spent invite (used,
 * expired, revoked) is said plainly, never dropped silently.
 */
export default function InvitationHost({ children }: { children: ReactNode }): React.ReactElement | null {
  const { api } = useSessionApi();
  const navigate = useNavigate();
  const signedIn = api.session.status === 'signed-in' ? api.session : null;
  const [token, setToken] = useState<string | null>(() => pendingInvite());
  const [deferred, setDeferred] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    const current = pendingInvite();
    setToken(current);
    const org = pendingInviteOrg();
    if (!current || !org) return;
    let live = true;
    setChecking(true);
    listWorkspaces(signedIn.client)
      .then((workspaces) => {
        if (!live || !workspaces.some((w) => w.namespaceId === org)) return;
        const route = pendingInviteRoute();
        dropInvite();
        setToken(null);
        setOutcome({ kind: 'member', org, route });
      })
      // Unknown membership: ask, as for a link that names no org.
      .catch(() => {})
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, [signedIn]);

  if (outcome) {
    const done = () => {
      setOutcome(null);
      if (outcome.kind === 'member') {
        announceJoined(outcome.org);
        navigate(outcome.route);
      }
    };
    return (
      <Page>
        <Card aria-labelledby="invite-outcome-title" data-testid="invitation-outcome">
          <h3 id="invite-outcome-title">
            {outcome.kind === 'member' ? "You're already in this workspace" : 'This invite cannot be used'}
          </h3>
          <p className="sub">
            {outcome.kind === 'member'
              ? 'The invitation was for a workspace you are already a member of, so there is nothing to accept. It is still unused for the person it was meant for.'
              : SPENT_INVITE}
          </p>
          <Actions>
            <PrimaryBtn data-testid="invitation-continue" onClick={done}>
              {outcome.kind === 'member' ? 'Open the workspace' : 'Continue'}
            </PrimaryBtn>
          </Actions>
        </Card>
      </Page>
    );
  }

  if (!token) return <>{children}</>;
  if (api.session.status === 'connecting') return null;

  if (!signedIn) {
    if (deferred) return <>{children}</>;
    return (
      <Page>
        <Card aria-labelledby="invite-signin-title" data-testid="invitation-page">
          <SignInPanel titleId="invite-signin-title" />
          <TextLink type="button" data-testid="invitation-later" onClick={() => setDeferred(true)} disabled={api.busy}>
            Not now
          </TextLink>
        </Card>
      </Page>
    );
  }

  const { client } = signedIn;

  const dismiss = () => {
    dropInvite();
    setToken(null);
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    const route = pendingInviteRoute();
    try {
      const org = joinedOrg(await client.redeemInvite(token));
      dropInvite();
      setToken(null);
      if (org) announceJoined(org);
      navigate(route);
    } catch (e) {
      if (isSpentInvite(e)) {
        dropInvite();
        setToken(null);
        setOutcome({ kind: 'spent' });
      } else {
        setError(`The invitation could not be accepted: ${describeError(e)}`);
      }
    } finally {
      setBusy(false);
      api.store?.sync(client);
    }
  };

  return (
    <Page>
      <Card aria-labelledby="invite-join-title" data-testid="invitation-dialog">
        <h3 id="invite-join-title">Join the workspace?</h3>
        <p className="sub">
          You were invited to a workspace on {PRODUCT_NAME}. Joining makes you a member: you will see its
          repositories and can file and triage issues.
        </p>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Actions>
          <SecondaryBtn onClick={dismiss} disabled={busy}>Not now</SecondaryBtn>
          <PrimaryBtn data-testid="invitation-join" onClick={() => void join()} disabled={busy || checking}>
            {busy || checking ? <Spin /> : error ? 'Try again' : 'Join'}
          </PrimaryBtn>
        </Actions>
      </Card>
    </Page>
  );
}
