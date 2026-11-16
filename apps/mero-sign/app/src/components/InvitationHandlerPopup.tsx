import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AcceptInviteDialog } from '@calimero-network/mero-react';

import { useMaybeSignedIn, useSessionApi } from '../sessionContext';
import { setActiveWorkspace } from '../lib/activeWorkspace';
import { enterAgreement } from '../lib/agreements';
import { PRODUCT_NAME } from '../lib/agreements';
import {
  dropInvite,
  pendingInvite,
  type PendingInvite,
} from '../lib/invites';
import { errorMessage, setContextId } from '../lib/node';
import styles from '../pages/app/AgreementsPage.module.css';
import { isSpentInvite, listAppInfos } from '@calimero-apps/connect';

/**
 * "Join this workspace?" for an invitation that arrived as a link
 * (`?invite=<token>[&agreement=<app id>]`, taken into storage before the first
 * render, see `captureInvite`).
 *
 * Mounted at the APP level because a link can land on any route. It asks
 * rather than joins: joining puts you in someone's workspace, and a forwarded
 * link should not do that silently. Signed out, `InvitationPage` stands in for
 * the app and offers the passkey sign-in; the token survives a sign-in, and
 * this asks the moment a session exists. A sign-up from that page already
 * joined with it (`api.joinedInvite`): this goes straight on to what the link
 * names, with nothing redeemed again. Someone already in the workspace (the
 * inviter opening their own link) is told so by the dialog, which redeems
 * nothing, and goes on to what the link names the same way.
 *
 * The shared dialog redeems the org invite (through the node's consent page
 * for a session bound to the app). Then, for a link that names an agreement,
 * puts you on its roster as a signer (`registerSelfAsParticipant`) and records
 * it in your private library before opening it. There is no "waiting for the
 * agreement to replicate" stage any more: nothing has to sync before a new
 * member can read.
 */
export default function InvitationHandlerPopup() {
  const signedIn = useMaybeSignedIn();
  const { api } = useSessionApi();
  const joinedInvite = api.joinedInvite ?? null;
  const navigate = useNavigate();
  const [invite, setInvite] = useState<PendingInvite | null>(() =>
    pendingInvite(),
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Joined (by the sign-up, or by the dialog), and into which org: only what
  // the link names is left, never a second redeem.
  const [joined, setJoined] = useState<{ org: string | null } | null>(null);
  const client = signedIn?.client ?? null;
  const joinedHere = invite !== null && invite.token === joinedInvite;

  const dismiss = useCallback(() => {
    dropInvite();
    setInvite(null);
    setError(null);
  }, []);

  /** Opens what the link names, once joined. A failure is retried without redeeming again. */
  const join = useCallback(async () => {
    if (!signedIn || !invite || !joined) return;
    setBusy(true);
    setError(null);
    try {
      const { org } = joined;
      if (org) setActiveWorkspace(org);
      if (invite.agreement) {
        setStatus('Recording you as a participant so you can sign.');
        const apps = await listAppInfos(signedIn.client).catch(() => []);
        const name =
          apps.find((a) => a.appId === invite.agreement)?.name ?? 'Agreement';
        await enterAgreement(
          signedIn.client,
          {
            source: signedIn.source,
            appId: invite.agreement,
            accountId: signedIn.accountId,
            name,
          },
          signedIn.after,
        );
        setContextId(invite.agreement);
        setInvite(null);
        navigate(`/agreements/${invite.agreement}`, { replace: true });
      } else {
        setInvite(null);
        navigate(org ? `/workspaces/${org}` : '/workspaces', { replace: true });
      }
    } catch (e) {
      setError(`The invitation could not be accepted: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
      setStatus(null);
      signedIn.after();
    }
  }, [signedIn, invite, navigate, joined]);

  // Signed up on the invitation page with this invite: joined already, so go
  // on to what it names. Only a failure there shows the dialog.
  useEffect(() => {
    if (!client || !joinedHere || joined) return;
    dropInvite();
    setJoined({ org: invite?.org ?? null });
  }, [client, joinedHere, joined, invite?.org]);
  const started = useRef(false);
  useEffect(() => {
    if (!joined || started.current) return;
    started.current = true;
    void join();
  }, [joined, join]);

  if (!signedIn || !invite) return null;
  // Opening what a sign-up joined: nothing to ask unless it failed.
  if (joinedHere && !error) return null;

  if (!joined) {
    return (
      <AcceptInviteDialog
        client={signedIn.client}
        passkey={signedIn.passkey()}
        open
        token={invite.token}
        org={invite.org ?? undefined}
        appName={PRODUCT_NAME}
        labels={{
          noun: 'workspace',
          body: invite.agreement
            ? 'Joining gives you access to the workspace and takes you straight into the agreement you were invited to sign.'
            : 'Joining gives you access to the workspace and every agreement in it.',
        }}
        onClose={dismiss}
        onError={(e) => {
          if (isSpentInvite(e)) dropInvite();
        }}
        onJoined={({ org }) => {
          dropInvite();
          setJoined({ org });
        }}
      />
    );
  }

  return (
    <div className={styles.modalBackdrop}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="invitation-title"
        data-testid="invitation-dialog"
      >
        <h2 className={styles.modalTitle} id="invitation-title">
          You joined the workspace
        </h2>
        <p className={styles.modalDesc}>
          {invite.agreement
            ? 'Next is the agreement you were invited to sign.'
            : 'Next is the workspace.'}
        </p>
        {status && <p className={styles.hint}>{status}</p>}
        {error && (
          <p className={styles.error} role="alert" data-testid="invitation-error">
            {error}
          </p>
        )}
        <div className={styles.modalRow}>
          <button
            type="button"
            className={styles.btnGhost}
            onClick={dismiss}
            disabled={busy}
            data-testid="invitation-dismiss"
          >
            Close
          </button>
          <button
            type="button"
            className={styles.btn}
            onClick={() => void join()}
            disabled={busy}
            data-testid="invitation-join"
          >
            {busy ? <span className={styles.spinner} /> : null}
            {busy ? 'Opening…' : 'Try again'}
          </button>
        </div>
      </div>
    </div>
  );
}
