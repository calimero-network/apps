// The one way into a workspace someone invited you to: open the link they
// sent, and say yes here.
//
// index.tsx takes the invitation off the address bar into storage before the
// app renders (`captureInvite`), so it survives the passkey sign-in. Once the
// session is signed in, this asks before redeeming the org invite token; a
// redeemed invite makes the person a member of the workspace's organization
// (and, for a folder invite, of the folder's team), with nothing to sync
// before the workspace opens. Test ids: `invite-prompt`, `invite-accept`,
// `invite-decline`, `invite-error`.

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
import { describeError } from '@calimero-apps/connect';
import {
  dropInvite,
  pendingInvite,
  type PendingInvite,
} from '@/hooks/useNamespaceInvitation';
import { rememberNamespaceName } from '@/hooks/namespaceNames';

interface Props {
  /** After a successful join: take the person into the workspace they joined. */
  onJoined: (workspaceId: string | null, folderId: string | null) => void;
}

const scopeOf = (invite: PendingInvite) => (invite.kind === 'namespace' ? 'workspace' : 'folder');

/** The node's words for an invite it will never take: copy the person can act on. */
function failureCopy(cause: unknown, noun: string): string {
  const text = describeError(cause);
  if (/expired/i.test(text)) return `This invitation has expired. Ask the person who invited you for a new link.`;
  if (/used|spent|redeemed/i.test(text)) return `This invitation link was already used. Ask for a new one to join the ${noun}.`;
  return `Couldn't join the ${noun}: ${text}`;
}

export function InvitationPrompt({ onJoined }: Props) {
  const { admin, isAuthenticated } = useMero();
  const [invite, setInvite] = useState<PendingInvite | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInvite(isAuthenticated ? pendingInvite() : null);
  }, [isAuthenticated]);

  const decline = useCallback(() => {
    dropInvite();
    setInvite(null);
    setError(null);
  }, []);

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
      setError(failureCopy(e, scopeOf(invite)));
    } finally {
      setBusy(false);
    }
  }, [admin, invite, onJoined]);

  if (!invite) return null;
  const noun = scopeOf(invite);
  const named = invite.targetName ? ` “${invite.targetName}”` : '';

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && decline()}>
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
          <Button variant="ghost" onClick={decline} disabled={busy} data-testid="invite-decline">
            Not now
          </Button>
          <Button onClick={() => void accept()} disabled={busy} data-testid="invite-accept">
            {busy ? 'Joining…' : `Join ${noun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
