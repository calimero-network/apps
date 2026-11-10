import React, { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { SPENT_INVITE_COPY, describeRedeemFailure, isSpentInvite, joinedOrg, memberOf } from '@calimero-apps/connect';
import { orgMemberName, setOrgName } from '@calimero-apps/names';

import { PRODUCT_NAME } from '../config';
import { useSessionApi } from '../sessionContext';
import { announceJoined } from '../hooks/workspacePersistence';
import { inviteRoute, invites } from '../workspaces';
import { SignInPanel, usePendingInvite } from '@calimero-apps/passkey';
import '@calimero-apps/passkey/passkey.css';
import { ONBOARDING, takeJoinedLanding } from '../session';
import { Page, Card, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin, TextLink } from './modalKit';
import AliasGate from './AliasGate';

/** What the screen says once the invitation can no longer be accepted. */
type Outcome = { kind: 'member'; org: string; route: string } | { kind: 'spent' };

/** Joined, and the workspace has no name for you yet: asked before opening it. */
type Naming = { org: string; route: string };

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
 *    goes to the route the link opened (e.g. `/crm/members`). Your name in the
 *    workspace is asked right after joining, once, unless it already has one;
 *    every pipeline in it then uses that name.
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
  const pending = usePendingInvite(invites);
  const token = pending?.token ?? null;
  const pendingOrg = pending?.org ?? null;
  const [deferred, setDeferred] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [naming, setNaming] = useState<Naming | null>(null);

  // A sign-up that joined with the invite: open the page its link pointed at.
  useEffect(() => {
    if (!signedIn) return;
    const route = takeJoinedLanding();
    if (route) navigate(route);
  }, [signedIn, navigate]);

  useEffect(() => {
    if (!signedIn || !token || !pendingOrg) return;
    let live = true;
    setChecking(true);
    void memberOf(signedIn.client, pendingOrg)
      .then((member) => {
        // Unknown membership (`null`): ask, as for a link that names no org.
        if (!live || !member) return;
        const route = inviteRoute(invites.pending());
        invites.drop();
        setOutcome({ kind: 'member', org: pendingOrg, route });
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
      setChecking(false);
    };
  }, [signedIn, token, pendingOrg]);

  if (naming && signedIn) {
    const open = () => {
      setNaming(null);
      announceJoined(naming.org);
      navigate(naming.route);
    };
    return (
      <Page>
        <AliasGate
          namespaceId={naming.org}
          identity={signedIn.accountId}
          orgName=""
          membersLoaded
          onSave={(name) => setOrgName(signedIn.client, naming.org, signedIn.accountId, name)}
          onDone={open}
        />
      </Page>
    );
  }

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
              : SPENT_INVITE_COPY}
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
          <SignInPanel {...ONBOARDING} api={api} titleId="invite-signin-title" />
          <TextLink type="button" data-testid="invitation-later" onClick={() => setDeferred(true)} disabled={api.busy}>
            Not now
          </TextLink>
        </Card>
      </Page>
    );
  }

  const { client } = signedIn;

  const dismiss = () => invites.drop();

  const join = async () => {
    setBusy(true);
    setError(null);
    const route = inviteRoute(pending);
    try {
      const org = joinedOrg(await client.redeemInvite(token)) ?? pendingOrg;
      invites.drop();
      // Your name in the workspace: asked now, once, unless it already has one
      // (a rejoin). Unknown (the read failed): asked too; the gate prefills it.
      if (org) {
        const o = (await client.getOrg(org).catch(() => null)) as { memberMetadata?: Record<string, unknown> } | null;
        if (!orgMemberName(o?.memberMetadata, signedIn.accountId)) {
          setNaming({ org, route });
          return;
        }
        announceJoined(org);
      }
      navigate(route);
    } catch (e) {
      // Only the node's word that the invite is done drops it: a lapsed
      // session, a rate limit or a network failure keeps it to try again.
      if (isSpentInvite(e)) {
        invites.drop();
        setOutcome({ kind: 'spent' });
      } else {
        setError(describeRedeemFailure(e));
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
          pipelines and can work their deals.
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
