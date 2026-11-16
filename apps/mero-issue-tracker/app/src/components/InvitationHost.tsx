import React, { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AcceptInviteDialog } from '@calimero-network/mero-react';
import { isSpentInvite } from '@calimero-apps/connect';
import { orgMemberName, setOrgName } from '@calimero-apps/names';

import { PRODUCT_NAME } from '../config';
import { useSessionApi } from '../sessionContext';
import { announceJoined } from '../hooks/workspacePersistence';
import { inviteRoute, invites } from '../workspaces';
import { SignInPanel, usePendingInvite } from '@calimero-apps/passkey';
import '@calimero-apps/passkey/passkey.css';
import { ONBOARDING, takeJoinedLanding } from '../session';
import { Page, Card, TextLink } from './modalKit';
import AliasGate from './AliasGate';

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
 *  - signed in: the shared join dialog straight away. The org invite is
 *    redeemed only on the click, as v1 joined only on the click, and joining
 *    goes to the route the link opened (e.g. `/issue-tracker/board`). Your name in the
 *    workspace is asked right after joining, once, unless it already has one;
 *    every repository in it then uses that name.
 *
 * A member of the invited workspace is told so by the dialog, and continuing
 * runs the same follow-up as a join. A spent invite (used, expired, revoked)
 * is dropped when the node says so.
 */
export default function InvitationHost({ children }: { children: ReactNode }): React.ReactElement | null {
  const { api, deps } = useSessionApi();
  const navigate = useNavigate();
  const signedIn = api.session.status === 'signed-in' ? api.session : null;
  const stored = usePendingInvite(invites);
  // A spent invite leaves storage at once but stays on screen until closed, so its message is read.
  const [spent, setSpent] = useState<typeof stored>(null);
  const pending = stored ?? spent;
  const token = pending?.token ?? null;
  const [deferred, setDeferred] = useState(false);
  const [naming, setNaming] = useState<Naming | null>(null);

  // A sign-up that joined with the invite: open the page its link pointed at.
  useEffect(() => {
    if (!signedIn) return;
    const route = takeJoinedLanding();
    if (route) navigate(route);
  }, [signedIn, navigate]);

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

  const joined = async ({ org }: { org: string }) => {
    const route = inviteRoute(pending);
    invites.drop();
    // Your name in the workspace: asked now, once, unless it already has one
    // (a rejoin). Unknown (the read failed): asked too; the gate prefills it.
    const o = (await client.orgs.get({ org }).catch(() => null)) as {
      memberMetadata?: Record<string, unknown>;
    } | null;
    api.store?.sync(client);
    if (!orgMemberName(o?.memberMetadata, signedIn.accountId)) {
      setNaming({ org, route });
      return;
    }
    announceJoined(org);
    navigate(route);
  };

  return (
    <Page>
      <AcceptInviteDialog
        client={client}
        passkey={deps.passkey()}
        token={token}
        appName={PRODUCT_NAME}
        org={pending?.org ?? undefined}
        open
        onClose={() => {
          setSpent(null);
          invites.drop();
        }}
        onError={(e) => {
          if (!isSpentInvite(e)) return;
          setSpent(pending);
          invites.drop();
        }}
        onJoined={(j) => void joined(j)}
      />
    </Page>
  );
}
