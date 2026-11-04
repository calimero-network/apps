// Sign in with a passkey, or create an account with a new one. Replaces v1's
// connect dialog (node discovery, a node URL, the Cloud wallet): on Calimero
// 1.0 the frontend already knows its cluster (merod local in development, the
// Calimero Cloud cluster in production) and the account is a passkey.

import { useEffect } from 'react';
import { AppListing, PasskeySignIn } from '@calimero-apps/passkey';
import '@calimero-apps/passkey/passkey.css';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LISTING, describeTarget, useSession } from '@/calimero/session';
import { pendingInvite } from '@/hooks/useNamespaceInvitation';

export function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useSession();
  const invited = open && pendingInvite() !== null;

  useEffect(() => {
    if (open && api.session.status === 'signed-in') onClose();
  }, [open, api.session.status, onClose]);

  const where =
    api.session.status === 'signed-out' || api.session.status === 'signed-in'
      ? describeTarget(api.session.target)
      : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !api.busy && onClose()}>
      <DialogContent data-testid="signin-dialog">
        <DialogHeader>
          <DialogTitle>{invited ? "You're invited" : 'Sign in'}</DialogTitle>
          <DialogDescription>
            {invited ? 'Sign in, or create an account, to join what you were invited to. ' : ''}
            Accounts are passkeys: nothing to remember, nothing to leak.
            {where ? ` Connected to ${where}.` : ''}
          </DialogDescription>
        </DialogHeader>

        {api.session.status === 'connecting' && (
          <p className="text-sm text-muted-foreground">Connecting…</p>
        )}
        {api.session.status === 'listing' && <AppListing {...LISTING} />}
        {api.session.status === 'unconfigured' && (
          <p className="text-sm text-destructive" role="alert">
            {api.session.message}
          </p>
        )}
        {api.session.status === 'signed-out' && <PasskeySignIn api={api} />}
      </DialogContent>
    </Dialog>
  );
}
