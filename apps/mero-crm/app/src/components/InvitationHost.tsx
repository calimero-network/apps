import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalimeroError } from '@calimero-network/mero-js';
import { describeError } from '@calimero-apps/connect';

import { APP_ROUTE } from '../config';
import { useSessionApi } from '../sessionContext';
import { announceJoined } from '../hooks/workspacePersistence';
import { dropInvite, joinedOrg, pendingInvite } from '../workspaces';
import { Overlay, Dialog, Actions, SecondaryBtn, PrimaryBtn, ErrorLine, Spin } from './modalKit';

/**
 * The invitation prompt, mounted above the router because a link can land on
 * any route. `main.tsx` took `?invite=` into storage before React mounted, so
 * the token survives a sign-up; once a session exists this asks "Join the
 * workspace?" and redeems the org invite only on the click, as v1 joined only
 * on the click. A refusal (used, expired, revoked) drops the token; anything
 * else keeps it for the next load.
 */
export default function InvitationHost(): React.ReactElement | null {
  const { api } = useSessionApi();
  const navigate = useNavigate();
  const signedIn = api.session.status === 'signed-in' ? api.session : null;
  const [token, setToken] = useState<string | null>(() => pendingInvite());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (signedIn) setToken(pendingInvite());
  }, [signedIn]);

  if (!signedIn || !token) return null;
  const { client } = signedIn;

  const dismiss = () => {
    dropInvite();
    setToken(null);
  };

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      const org = joinedOrg(await client.redeemInvite(token));
      dropInvite();
      setToken(null);
      if (org) announceJoined(org);
      navigate(APP_ROUTE);
    } catch (e) {
      if (e instanceof CalimeroError && e.status < 500) dropInvite();
      setError(`The invitation could not be accepted: ${describeError(e)}`);
    } finally {
      setBusy(false);
      api.store?.sync(client);
    }
  };

  return (
    <Overlay>
      <Dialog role="dialog" aria-modal="true" aria-labelledby="invite-join-title" data-testid="invitation-dialog">
        <h3 id="invite-join-title">Join the workspace?</h3>
        <p className="sub">
          You were invited to a workspace on Mero CRM. Joining makes you a member: you will see its
          pipelines and can work their deals.
        </p>
        {error && <ErrorLine>{error}</ErrorLine>}
        <Actions>
          <SecondaryBtn onClick={dismiss} disabled={busy}>{error ? 'Close' : 'Not now'}</SecondaryBtn>
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
