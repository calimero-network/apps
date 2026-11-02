// Sign in with a passkey, or create an account with a new one. Replaces v1's
// connect dialog (node discovery, a node URL, the Cloud wallet): on Calimero
// 1.0 the frontend already knows its cluster (merod local in development, the
// Calimero Cloud cluster in production) and the account is a passkey.

import React, { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { describeTarget, useSession } from '@/calimero/session';
import { pendingInvite } from '@/hooks/useNamespaceInvitation';

export function SignInDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const api = useSession();
  const [name, setName] = useState('');
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
        {api.session.status === 'unconfigured' && (
          <p className="text-sm text-destructive" role="alert">
            {api.session.message}
          </p>
        )}
        {api.session.status === 'signed-out' && (
          <div className="flex flex-col gap-3">
            <Button data-testid="signin-passkey" disabled={api.busy} onClick={() => void api.signIn()}>
              {api.busy ? 'Waiting for your passkey…' : 'Sign in with a passkey'}
            </Button>
            <div className="mt-2 border-t border-border pt-3">
              <label className="text-xs text-muted-foreground" htmlFor="signup-name">
                New here? Your name
              </label>
              <div className="mt-1 flex gap-2">
                <Input
                  id="signup-name"
                  value={name}
                  maxLength={64}
                  placeholder="Ada Lovelace"
                  onChange={(e) => setName(e.target.value)}
                />
                <Button
                  variant="outline"
                  data-testid="signup-passkey"
                  disabled={api.busy || !name.trim()}
                  onClick={() => void api.signUp(name.trim())}
                >
                  Create account
                </Button>
              </div>
            </div>
          </div>
        )}
        {api.error && (
          <p className="text-sm text-destructive" role="alert" data-testid="signin-error">
            {api.error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
