// Sign in with a passkey, or create an account with a new one. Replaces v1's
// connect dialog (node discovery, a node URL, the Cloud wallet): on Calimero
// 1.0 the frontend already knows its cluster (merod local in development, the
// Calimero Cloud cluster in production) and the account is a passkey.

import { useEffect } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useSession } from '@/calimero/session';
import { pendingInvite } from '@/hooks/useNamespaceInvitation';
import { SignInPanel } from './SignInPanel';

export function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useSession();
  const invite = open ? pendingInvite() : null;

  useEffect(() => {
    if (open && api.session.status === 'signed-in') onClose();
  }, [open, api.session.status, onClose]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !api.busy && onClose()}>
      <DialogContent data-testid="signin-dialog">
        <SignInPanel invite={invite} inDialog />
      </DialogContent>
    </Dialog>
  );
}
