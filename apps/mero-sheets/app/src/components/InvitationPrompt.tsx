/**
 * "Join this workspace?" for an invitation that arrived as a link (`?invite=`,
 * taken into storage before the first render: see `captureInvite`).
 *
 * Mounted at the APP level because a link can land on any route, and it asks
 * rather than joins: joining puts you in someone's organization, and a
 * forwarded link or a refreshing background tab should not do that silently.
 *
 * Signed out, `InvitationPage` stands in for the app and offers the sign-in;
 * the token survives a sign-in, and this asks the moment a session exists. A
 * sign-up from that page already joined with it (`api.joinedInvite`): this
 * only opens what the link named, with nothing redeemed again.
 * Someone already in the workspace (the inviter opening their own link) is
 * told so and the token dropped: redeeming it would spend its single use, and
 * the person it was meant for could no longer join. Join redeems the org
 * invite and reports what to open: the spreadsheet the link names, or the
 * workspace's list. A refused invite (unknown, used, expired, revoked) is said
 * plainly. There is no "Syncing…" stage any more: nothing has to replicate
 * before a new member can read.
 */
import { useCallback, useEffect, useState } from 'react';
import { APP_DISPLAY_NAME } from '../config';
import { describeRedeemFailure } from '@calimero-apps/connect';
import { useMaybeSignedIn, useSessionApi } from '../sessionContext';
import {
  INVITE_REFUSED,
  alreadyMember,
  dropInvite,
  inviteRefused,
  joinedOrg,
  pendingInvite,
  type AcceptedInvite,
  type PendingInvite,
} from '../lib/workspaces';
import { Dialog, Err, Hint, Overlay, Primary, Secondary } from './SignInModal';

export default function InvitationPrompt({ onJoined }: { onJoined: (landed: AcceptedInvite) => void }) {
  const signedIn = useMaybeSignedIn();
  const { api } = useSessionApi();
  const joinedInvite = api.joinedInvite ?? null;
  const [invite, setInvite] = useState<PendingInvite | null>(() => pendingInvite());
  // `null` until the membership check answers; `false` too when it cannot.
  const [member, setMember] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refused, setRefused] = useState(false);
  const [joinedAtSignUp, setJoinedAtSignUp] = useState<PendingInvite | null>(null);
  const client = signedIn?.client ?? null;

  // Signing in on the invitation page leaves the token where it was: re-read it.
  // Signing up there joined with it already: open what it named, ask nothing.
  useEffect(() => {
    if (!client) return;
    if (invite && invite.token === joinedInvite) {
      setInvite(null);
      setJoinedAtSignUp(invite);
      return;
    }
    setInvite((prev) => reread(prev));
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per session; `joinedInvite` is set before it signs in
  }, [client]);

  // Opened one render later: the landing page's own redirect into the app
  // runs in the sign-in's render, and would replace this navigation's state.
  useEffect(() => {
    if (!joinedAtSignUp) return;
    setJoinedAtSignUp(null);
    onJoined({ namespaceId: joinedAtSignUp.org, contextId: joinedAtSignUp.sheet });
  }, [joinedAtSignUp, onJoined]);

  useEffect(() => {
    if (!client || !invite || invite.token === joinedInvite) return undefined;
    let live = true;
    setMember(null);
    void alreadyMember(client, invite).then((known) => {
      if (!live) return;
      if (known) dropInvite();
      setMember(known ?? false);
    });
    return () => {
      live = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- once per token, not per re-read
  }, [client, invite?.token]);

  const dismiss = useCallback(() => {
    dropInvite();
    setInvite(null);
    setError(null);
  }, []);

  const open = useCallback(() => {
    if (!invite) return;
    dismiss();
    onJoined({ namespaceId: invite.org, contextId: invite.sheet });
  }, [invite, dismiss, onJoined]);

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
      // A refusal (unknown, used, expired, revoked) can never succeed: drop it.
      // Anything else (a lapsed session, a rate limit, the cluster
      // unreachable) is kept for another try.
      if (inviteRefused(e)) {
        dropInvite();
        setRefused(true);
        setError(INVITE_REFUSED);
      } else {
        setError(describeRedeemFailure(e));
      }
    } finally {
      setBusy(false);
      signedIn.after();
    }
  }, [signedIn, invite, onJoined]);

  if (!signedIn || !invite || member === null) return null;

  if (member) {
    return (
      <Overlay>
        <Dialog role="dialog" aria-modal="true" aria-labelledby="invitation-title" data-testid="invitation-dialog">
          <h3 id="invitation-title">You&apos;re already in this workspace</h3>
          <Hint data-testid="invitation-member">
            This invitation is for a workspace you are already a member of, so there is nothing to join. The link was
            left unused for whoever it was meant for.
          </Hint>
          <Primary type="button" onClick={open} data-testid="invitation-open">
            Open it
          </Primary>
        </Dialog>
      </Overlay>
    );
  }

  return (
    <Overlay>
      <Dialog role="dialog" aria-modal="true" aria-labelledby="invitation-title" data-testid="invitation-dialog">
        <h3 id="invitation-title">Join the workspace?</h3>
        <Hint>
          {invite.sheet
            ? `You were invited to a workspace in ${APP_DISPLAY_NAME}. Joining gives you the workspace and takes you straight into the spreadsheet you were invited to.`
            : `You were invited to a workspace in ${APP_DISPLAY_NAME}. Joining gives you the workspace and every spreadsheet in it.`}
        </Hint>
        {error && (
          <Err role="alert" data-testid="invitation-error">
            {error}
          </Err>
        )}
        {!refused && (
          <Primary type="button" onClick={() => void join()} disabled={busy} data-testid="invitation-join">
            {busy ? 'Joining…' : 'Join'}
          </Primary>
        )}
        <Secondary type="button" onClick={dismiss} disabled={busy} data-testid="invitation-dismiss">
          {refused ? 'Close' : 'Not now'}
        </Secondary>
      </Dialog>
    </Overlay>
  );
}

/**
 * The invitation to ask about once there is a session: the one already held,
 * or the stored one. Never a fresh copy of the one held: that would re-run the
 * membership check and close and reopen the dialog (closing it is "Not now"),
 * and after the check has dropped an already-member's token it would lose the
 * "You're already in" answer before anyone read it.
 */
function reread(prev: PendingInvite | null): PendingInvite | null {
  return prev ?? pendingInvite();
}
