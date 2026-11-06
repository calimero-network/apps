import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { describeError } from '@calimero-apps/connect';

import { APP_ROUTE } from '../config';
import { useSessionApi } from '../sessionContext';
import { announceJoined } from '../hooks/workspacePersistence';
import {
  INVITE_SPENT,
  dropInvite,
  inviteRefused,
  joinedOrg,
  listWorkspaces,
  mintedOrg,
  pendingInvite,
} from '../workspaces';
import { Overlay, Dialog, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin } from './modalKit';

/**
 * The invitation prompt, mounted above the router because a link can land on
 * any route. `main.tsx` took `?invite=` into storage before React mounted, so
 * the token survives a sign-up; once a session exists this asks "Join the
 * workspace?" and redeems the org invite only on the click, as v1 joined only
 * on the click. A refusal (used, expired, revoked) drops the token; anything
 * else keeps it for the next load.
 *
 * Someone already in the invite's org is told so instead: redeeming would
 * spend the invite's single use on a person who needs none of it. The org is
 * known only for an invite this browser minted (`mintedOrg`); for any other
 * the prompt stays.
 */
export default function InvitationHost(): React.ReactElement | null {
  const { api } = useSessionApi();
  const navigate = useNavigate();
  const location = useLocation();
  const signedIn = api.session.status === 'signed-in' ? api.session : null;
  const [token, setToken] = useState<string | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The org of an invite this account is already a member of. */
  const [memberOf, setMemberOf] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (signedIn) setToken(pendingInvite());
  }, [signedIn]);

  const client = signedIn?.client ?? null;
  useEffect(() => {
    if (!client || !token) return;
    const org = mintedOrg(token);
    if (!org) return;
    let live = true;
    setChecking(true);
    listWorkspaces(client)
      .then((ws) => {
        if (!live || !ws.some((w) => w.namespaceId === org)) return;
        dropInvite();
        setMemberOf(org);
      })
      .catch(() => {
        /* unknown: keep the prompt */
      })
      .finally(() => live && setChecking(false));
    return () => {
      live = false;
    };
  }, [client, token]);

  if (!signedIn || !token || checking) return null;

  // Stay on a deep-linked route inside the app; from anywhere else, open it.
  const enter = () => {
    if (!location.pathname.startsWith(APP_ROUTE)) navigate(APP_ROUTE);
  };

  const close = () => {
    dropInvite();
    setToken(null);
    setMemberOf(null);
  };

  if (memberOf) {
    return (
      <Overlay>
        <Dialog role="dialog" aria-modal="true" aria-labelledby="invite-member-title" data-testid="invitation-already-member">
          <h3 id="invite-member-title">You're already in this workspace</h3>
          <p className="sub">
            This invite is for a workspace you are a member of, so it was not used. It is still there for the
            person you meant to send it to.
          </p>
          <Actions>
            <PrimaryBtn
              data-testid="invitation-open"
              onClick={() => {
                announceJoined(memberOf);
                close();
                enter();
              }}
            >
              Open it
            </PrimaryBtn>
          </Actions>
        </Dialog>
      </Overlay>
    );
  }

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const org = joinedOrg(await signedIn.client.redeemInvite(token));
      dropInvite();
      setToken(null);
      if (org) announceJoined(org);
      enter();
    } catch (e) {
      if (inviteRefused(e)) {
        dropInvite();
        setError(INVITE_SPENT);
      } else {
        setError(`The invitation could not be accepted: ${describeError(e)}`);
      }
    } finally {
      setBusy(false);
      api.store?.sync(signedIn.client);
    }
  };

  return (
    <Overlay>
      <Dialog role="dialog" aria-modal="true" aria-labelledby="invite-join-title" data-testid="invitation-dialog">
        <h3 id="invite-join-title">Join the workspace?</h3>
        <p className="sub">
          You were invited to a workspace on Mero Issue Tracker. Joining makes you a member: you will see its
          repositories and can file and triage issues.
        </p>
        {error && <ErrorLine data-testid="invitation-error">{error}</ErrorLine>}
        <Actions>
          <SecondaryBtn onClick={close} disabled={busy}>{error ? 'Close' : 'Not now'}</SecondaryBtn>
          {!error && (
            <PrimaryBtn data-testid="invitation-join" onClick={() => void join()} disabled={busy}>
              {busy ? <Spin /> : 'Join'}
            </PrimaryBtn>
          )}
        </Actions>
      </Dialog>
    </Overlay>
  );
}
