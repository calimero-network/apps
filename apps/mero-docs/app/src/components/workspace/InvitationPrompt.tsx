// The one way into a workspace someone invited you to: open the link they
// sent, and say yes here.
//
// index.tsx takes the invitation off the address bar into storage before the
// app renders (`captureInvite`), so it survives the passkey sign-in on the
// invitation page (InvitationPage). Once the
// session is signed in, this asks before redeeming the org invite token; a
// redeemed invite makes the person a member of the workspace's organization
// (and, for a folder invite, of the folder's team), with nothing to sync
// before the workspace opens. Test ids: `invite-prompt`, `invite-accept`,
// `invite-decline`, `invite-error`.
//
// Someone already in the workspace is not offered Join: redeeming spends the
// link's single use, so the owner trying their own link used to leave the
// person it was meant for with "unknown invite". For a workspace invite the
// link names its workspace, and when this account's orgs include it the token
// is dropped unspent and the prompt says so. A folder invite also gives a row
// in the folder's team, which org membership does not prove, so it asks.

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMero } from '@/calimero/react';
import { SPENT_INVITE_COPY, describeError, isSpentInvite } from '@calimero-apps/connect';
import {
  dropInvite,
  inviteScope,
  pendingInvite,
  takeJoinedAtSignUp,
  type PendingInvite,
} from '@/hooks/useNamespaceInvitation';
import { rememberNamespaceName } from '@/hooks/namespaceNames';

interface Props {
  /** After a successful join: take the person into the workspace they joined. */
  onJoined: (workspaceId: string | null, folderId: string | null) => void;
}

/**
 * The node's words for an invite it will never take: copy the person can act
 * on. Anything else (a lapsed session, a rate limit, the cluster unreachable)
 * keeps the token for another try.
 */
function failureCopy(cause: unknown, noun: string): string {
  if (isSpentInvite(cause)) return SPENT_INVITE_COPY;
  return `Couldn't join the ${noun}: ${describeError(cause)}. Your invite is kept: try again.`;
}

export function InvitationPrompt({ onJoined }: Props) {
  const { admin, isAuthenticated } = useMero();
  const [invite, setInvite] = useState<PendingInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [spent, setSpent] = useState(false);
  /** null while it is being checked. */
  const [member, setMember] = useState<boolean | null>(null);

  useEffect(() => {
    setInvite(isAuthenticated ? pendingInvite() : null);
    // Signed up from a page holding the invite: already joined; open what it named.
    const joined = isAuthenticated ? takeJoinedAtSignUp() : null;
    if (joined) onJoined(joined.workspace, joined.folder);
    // `onJoined` is the router's; only the sign-in matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    if (!invite) return;
    if (invite.kind !== 'namespace' || !invite.workspaceId || !admin) {
      setMember(false);
      return;
    }
    let live = true;
    setMember(null);
    admin
      .isOrgMember(invite.workspaceId)
      .then((yes) => {
        if (!live) return;
        if (yes) dropInvite();
        setMember(yes);
      })
      // Cannot tell: ask, as before.
      .catch(() => live && setMember(false));
    return () => {
      live = false;
    };
  }, [invite, admin]);

  const close = useCallback(() => {
    setInvite(null);
    setError(null);
    setSpent(false);
  }, []);

  const decline = useCallback(() => {
    dropInvite();
    close();
  }, [close]);

  const accept = useCallback(async () => {
    if (!admin || !invite) return;
    setBusy(true);
    setError(null);
    try {
      const joined = (await admin.redeemInvite(invite.token)) ?? invite.workspaceId;
      if (invite.kind === 'namespace' && invite.targetName && joined) {
        rememberNamespaceName(joined, invite.targetName);
      }
      dropInvite();
      setInvite(null);
      onJoined(joined, invite.kind === 'group' ? invite.targetId : null);
    } catch (e) {
      console.warn('[InvitationPrompt] redeem failed', e);
      // A refusal (unknown, used, expired, revoked) can never succeed: drop
      // it. Anything else (a lapsed session, a rate limit, the cluster
      // unreachable) is kept for another try.
      if (isSpentInvite(e)) {
        dropInvite();
        setSpent(true);
      }
      setError(failureCopy(e, inviteScope(invite)));
    } finally {
      setBusy(false);
    }
  }, [admin, invite, onJoined]);

  if (!invite || member === null) return null;
  const noun = inviteScope(invite);
  const named = invite.targetName ? ` “${invite.targetName}”` : '';

  if (member) {
    return (
      <Dialog open onOpenChange={(open) => !open && close()}>
        <DialogContent data-testid="invite-prompt">
          <DialogHeader>
            <DialogTitle>You're already in this workspace</DialogTitle>
            <DialogDescription data-testid="invite-already-member">
              This account is already a member of{named || ' the workspace'}, so there is nothing to accept.
              The link is left unused for the person it was meant for.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                close();
                onJoined(invite.workspaceId, null);
              }}
              data-testid="invite-open"
            >
              Open workspace
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && (spent ? close : decline)()}>
      <DialogContent data-testid="invite-prompt">
        <DialogHeader>
          <DialogTitle>You're invited</DialogTitle>
          <DialogDescription>
            Join the {noun}
            {named} in Mero Docs?{' '}
            {invite.kind === 'group'
              ? "You'll only gain access to this folder, not the rest of the workspace."
              : "You'll be added to the workspace."}
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p className="text-sm text-destructive" role="alert" data-testid="invite-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={spent ? close : decline} disabled={busy} data-testid="invite-decline">
            {spent ? 'Close' : 'Not now'}
          </Button>
          {!spent && (
            <Button onClick={() => void accept()} disabled={busy} data-testid="invite-accept">
              {busy ? 'Joining…' : `Join ${noun}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
