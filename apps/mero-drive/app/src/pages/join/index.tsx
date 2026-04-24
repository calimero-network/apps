// Invite landing page. URL shape:
//   /join?kind={'namespace'|'group'}&id={targetId}&invite={base64url(JSON(SignedGroupOpenInvitation))}
//
// Accepts `ns=` as a legacy alias for `id=` when kind is namespace
// (so any namespace invites generated before the kind param was
// introduced still resolve).
//
// Flow:
//   1. Parse + validate URL params.
//   2. Unauthenticated → Connect CTA; after login the user lands
//      back here with the same query.
//   3. Authenticated → button to join; dispatches to
//      joinNamespace / joinGroup based on kind.
//   4. Success → /app (the namespace list / folder tree refetches
//      will surface the new membership on the next render).

import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ConnectButton, useMero } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/icons/Logo';
import {
  parseInviteUrl,
  useJoinNamespaceByInvite,
  useJoinFolderByInvite,
} from '@/hooks/useNamespaceInvitation';
import { markNamespaceJustJoined } from '@/hooks/useDriveWorkspace';

export default function JoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useMero();
  const { join: joinNs } = useJoinNamespaceByInvite();
  const { join: joinGroup } = useJoinFolderByInvite();

  const parsed = useMemo(() => parseInviteUrl(params), [params]);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onJoin = async () => {
    if ('error' in parsed) return;
    setJoining(true);
    setError(null);
    try {
      if (parsed.kind === 'namespace') {
        await joinNs(parsed.targetId, parsed.invitation);
        // Flag the fresh namespace so useDriveWorkspace shows a
        // "Syncing from peers…" state while the governance op +
        // registry state propagate, rather than a raw empty view.
        markNamespaceJustJoined(parsed.targetId);
      } else {
        await joinGroup(parsed.invitation);
        // For folder joins the namespace is already in place; no
        // sync gate needed — the folder's docs context will sync
        // in the background the usual way.
      }
      navigate('/app', { replace: true });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setJoining(false);
    }
  };

  const scopeLabel =
    'error' in parsed
      ? null
      : parsed.kind === 'namespace'
        ? 'workspace'
        : 'folder';

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <Logo size={28} />
          <h1 className="text-lg font-semibold">
            Join {scopeLabel ?? 'workspace'}
          </h1>
        </div>

        {'error' in parsed ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {parsed.error}
          </div>
        ) : (
          <>
            <p className="mb-6 text-sm text-muted-foreground">
              You've been invited to join {scopeLabel}{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
                {parsed.targetId.slice(0, 12)}…
              </code>
              {parsed.kind === 'group' ? (
                <>
                  . You'll only gain access to this folder — not the
                  workspace root or other folders.
                </>
              ) : (
                <>. You'll be added to the workspace root group.</>
              )}
            </p>

            {isLoading ? (
              <div className="text-sm text-muted-foreground">
                Checking your session…
              </div>
            ) : !isAuthenticated ? (
              <div className="space-y-3">
                <p className="text-sm">
                  Sign in with your Calimero identity to accept the
                  invitation.
                </p>
                <ConnectButton />
              </div>
            ) : (
              <Button
                className="w-full"
                disabled={joining}
                onClick={onJoin}
              >
                {joining ? 'Joining…' : 'Accept & join'}
              </Button>
            )}

            {error && (
              <div
                role="alert"
                className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
              >
                {error}
              </div>
            )}
          </>
        )}

        <div className="mt-6 text-center text-xs text-muted-foreground">
          <button
            type="button"
            className="underline hover:text-foreground"
            onClick={() => navigate('/')}
          >
            Not now, take me home
          </button>
        </div>
      </div>
    </main>
  );
}
