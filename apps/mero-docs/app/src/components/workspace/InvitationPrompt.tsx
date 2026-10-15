// The one way into a workspace someone invited you to: open the link they
// sent, and say yes here.
//
// Fed by the shared capture (`@calimero-apps/invite`, primed in index.tsx),
// which takes the link from wherever it arrived - the links page appending
// `?invitation=…` to this app's URL (web, PWA, a cold desktop start), or a
// running desktop's `deep-link` event - and buffers it until something asks.
// Mounted above the routes, so a link opened on any page, including one handed
// to an app already open on /app, reaches it.
//
// It asks before joining, and only once the session can join: signed out, the
// invitation waits in the capture's store (it survives the sign-in redirect)
// and the prompt appears after sign-in.

import React, { useEffect, useMemo, useState } from 'react';
import { useMero } from '@calimero-network/mero-react';
import { onInvitation, type CapturedInvitation } from '@calimero-apps/invite';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { parseInviteUrl } from '@/hooks/useNamespaceInvitation';
import { JoinInviteCard } from './JoinInviteCard';

interface Props {
  /** After a successful join (or "Open workspace" for one already joined):
   *  take the person into what they joined. */
  onJoined: () => void;
}

export function InvitationPrompt({ onJoined }: Props) {
  const { isAuthenticated } = useMero();
  const [captured, setCaptured] = useState<CapturedInvitation | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => onInvitation(setCaptured), []);

  // The link's params are the invitation: `invitation`, `kind`, `id`, `name`.
  const parsed = useMemo(
    () =>
      captured ? parseInviteUrl(new URLSearchParams(captured.params)) : null,
    [captured],
  );

  if (!captured || !parsed || !isAuthenticated) return null;

  // Declining acks the capture too: a link the person said no to must not
  // come back on the next load.
  const dismiss = () => {
    captured.resolve();
    setCaptured(null);
  };

  const scopeLabel =
    'error' in parsed
      ? 'workspace'
      : parsed.kind === 'namespace'
        ? 'workspace'
        : 'folder';

  return (
    <Dialog open onOpenChange={(open) => !open && !joining && dismiss()}>
      <DialogContent aria-describedby={undefined} data-testid="invite-prompt">
        <DialogHeader>
          <DialogTitle>Join {scopeLabel}</DialogTitle>
        </DialogHeader>
        {'error' in parsed ? (
          <>
            <div
              role="alert"
              data-testid="invite-error"
              className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {parsed.error}
            </div>
            <Button
              variant="ghost"
              className="mt-4 w-full"
              data-testid="invite-decline"
              onClick={dismiss}
            >
              Dismiss
            </Button>
          </>
        ) : (
          <JoinInviteCard
            parsed={parsed}
            onJoiningChange={setJoining}
            onJoined={() => {
              captured.resolve();
              setCaptured(null);
              onJoined();
            }}
            secondaryAction={{ label: 'Not now', onClick: dismiss }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
