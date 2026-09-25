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
//
// The accept-card body is shared with the in-app paste-link dialog
// (NamespaceJoinDialog) via JoinInviteCard — this page is the thin
// route wrapper around it.

import React, { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Logo } from '@/components/icons/Logo';
import { JoinInviteCard } from '@/components/workspace/JoinInviteCard';
import { parseInviteUrl } from '@/hooks/useNamespaceInvitation';

export default function JoinPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const parsed = useMemo(() => parseInviteUrl(params), [params]);

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
          <>
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {parsed.error}
            </div>
            <div className="mt-6 text-center text-xs text-muted-foreground">
              <button
                type="button"
                className="underline hover:text-foreground"
                onClick={() => navigate('/')}
              >
                Not now, take me home
              </button>
            </div>
          </>
        ) : (
          <JoinInviteCard
            parsed={parsed}
            onJoined={() => navigate('/app', { replace: true })}
            secondaryAction={{
              label: 'Not now, take me home',
              onClick: () => navigate('/'),
            }}
          />
        )}
      </div>
    </main>
  );
}
