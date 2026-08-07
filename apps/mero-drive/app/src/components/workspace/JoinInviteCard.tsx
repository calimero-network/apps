// Shared body for the invite-acceptance UI. Both the `/join` route
// (entered via a deep link or a pasted invite URL) and the in-app
// `NamespaceJoinDialog` (paste-into-textarea flow) render this so the
// preview + accept experience stays single-source.

import React, { useState } from 'react';
import {
  ConnectButton,
  useMero,
  useNamespacesForApplication,
} from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import {
  type ParsedInvite,
  classifyJoinError,
  isInviteExpired,
  useJoinFolderByInvite,
  useJoinNamespaceByInvite,
} from '@/hooks/useNamespaceInvitation';
import { markNamespaceJustJoined } from '@/hooks/useDriveWorkspace';
import { rememberNamespaceName } from '@/hooks/namespaceNames';

interface Props {
  parsed: ParsedInvite;
  /** Called after a successful join. Use to navigate away, close a
   *  modal, or refetch the namespace list. */
  onJoined: () => void | Promise<void>;
  /** Optional secondary link (e.g. "Not now" on the route, "Back to
   *  invite link" inside the dialog). Rendered as an underlined link
   *  below the primary action. */
  secondaryAction?: { label: string; onClick: () => void };
}

export function JoinInviteCard({ parsed, onJoined, secondaryAction }: Props) {
  const { isAuthenticated, isLoading, applicationId } = useMero();
  const { join: joinNs } = useJoinNamespaceByInvite();
  const { join: joinGroup } = useJoinFolderByInvite();
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Server-detected duplicates land here too (the join call rejecting
  // with an "already a member" message), not just the pre-check below.
  const [alreadyMember, setAlreadyMember] = useState(false);
  const [expiredByServer, setExpiredByServer] = useState(false);

  const scopeLabel = parsed.kind === 'namespace' ? 'workspace' : 'folder';
  const expired = isInviteExpired(parsed.invitation);

  // Pre-check namespace invites against the user's own namespace list so
  // "already a member" is an explicit state, not a server error. Folder
  // invites have no cheap client-side membership source; the join call's
  // error mapping covers them.
  const { namespaces } = useNamespacesForApplication(
    isAuthenticated && parsed.kind === 'namespace' ? applicationId : null,
  );
  const isMember =
    alreadyMember ||
    (parsed.kind === 'namespace' &&
      (namespaces ?? []).some((n) => n.namespaceId === parsed.targetId));

  const onJoinClick = async () => {
    setJoining(true);
    setError(null);
    try {
      if (parsed.kind === 'namespace') {
        await joinNs(parsed.targetId, parsed.invitation);
        // Persist the invite-carried namespace name so the workspace
        // switcher shows it immediately. `listNamespacesForApplication`
        // won't surface it until the joined node has synced the
        // namespace's root-group metadata — which can lag indefinitely.
        if (parsed.namespaceName) {
          rememberNamespaceName(parsed.targetId, parsed.namespaceName);
        }
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
      await onJoined();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      switch (classifyJoinError(message)) {
        case 'already-member':
          setAlreadyMember(true);
          break;
        case 'expired':
          setError(null);
          setExpiredByServer(true);
          break;
        default:
          setError(message);
      }
    } finally {
      // Also on success: onJoined usually navigates away, but a caller that
      // only closes a dialog would leave the button stuck on "Joining…".
      setJoining(false);
    }
  };

  const showExpired = expired || expiredByServer;

  return (
    <>
      <p className="mb-6 text-sm text-muted-foreground">
        You've been invited to join {scopeLabel}{' '}
        {parsed.namespaceName ? (
          <span className="font-medium text-foreground">
            {parsed.namespaceName}
          </span>
        ) : (
          <code className="rounded bg-muted px-1.5 py-0.5 text-xs text-foreground">
            {parsed.targetId.slice(0, 12)}…
          </code>
        )}
        {parsed.kind === 'group' ? (
          <>
            . You'll only gain access to this folder — not the workspace
            root or other folders.
          </>
        ) : (
          <>. You'll be added to the workspace root group.</>
        )}
      </p>

      {showExpired ? (
        <div
          role="alert"
          className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400"
        >
          This invitation has expired. Ask the person who invited you for
          a new link.
        </div>
      ) : isLoading ? (
        <div className="text-sm text-muted-foreground">
          Checking your session…
        </div>
      ) : !isAuthenticated ? (
        <div className="space-y-3">
          <p className="text-sm">
            Sign in with your Calimero identity to accept the invitation.
          </p>
          <ConnectButton />
        </div>
      ) : isMember ? (
        <div className="space-y-3">
          <p className="text-sm" role="status">
            You're already a member of this {scopeLabel}.
          </p>
          <Button className="w-full" onClick={() => void onJoined()}>
            Open workspace
          </Button>
        </div>
      ) : (
        <Button className="w-full" disabled={joining} onClick={onJoinClick}>
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

      {secondaryAction && (
        <div className="mt-6 text-center text-xs text-muted-foreground">
          <button
            type="button"
            className="underline hover:text-foreground"
            onClick={secondaryAction.onClick}
          >
            {secondaryAction.label}
          </button>
        </div>
      )}
    </>
  );
}
