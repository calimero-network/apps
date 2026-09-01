// Card shown in the folder pane when the caller can't read the
// selected folder. Three branches off `visibility`:
//
//   Open      → "Join folder" CTA. TWO core calls, in order:
//               (1) `joinSubgroupInheritance` (#2360 /
//                   POST /admin-api/groups/:id/join-via-inheritance)
//                   — materialises inherited subgroup membership +
//                   delivers the subgroup key;
//               (2) `joinContext` on the folder's docs context —
//                   writes this node's owned ContextIdentity so
//                   `execute` (list_docs, create_doc, …) works.
//               Then `refetch()` so useFolderPermissions re-evaluates
//               and the card unmounts in favour of the real folder
//               view.
//
//   Restricted → "Ask admin" + copy-identity. No self-join path;
//                the admin has to explicitly add this identity.
//
//   undefined  → Visibility metadata hasn't reached this node yet.
//                Shows a "syncing" copy + "Try joining" — same
//                action as Open (the call succeeds the moment
//                inheritance becomes resolvable on this node).
//
// #2360's `join-via-inheritance` replaced the pre-#2360
// `listGroupContexts` enumeration for SUBGROUP membership — but the
// per-docs-context `joinContext` is STILL required: core's
// `join_subgroup_inheritance` handler is subgroup-scoped (subgroup
// key + namespace `MemberJoinedOpen` op only) and never provisions a
// `ContextIdentity` for child contexts. `join_context` is the handler
// that does (it accepts inherited Open-subgroup membership), and it
// internally subscribes + syncs the joined context.

import React, { useState } from 'react';
import {
  Lock,
  Copy,
  Check,
  Loader2,
  LogIn,
  RotateCw,
} from 'lucide-react';
import {
  useJoinSubgroupInheritance,
  useJoinContext,
} from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';

interface Props {
  /** Folder subgroup id — the join target. */
  folderId: string;
  folderAlias: string;
  /** Current subgroup visibility from core's GroupInfo. `undefined`
   *  while the per-folder fetch is still in flight. */
  visibility: 'Open' | 'Restricted' | undefined;
  selfIdentity: string | null;
  /** Called after a successful join so the workspace re-checks
   *  membership and swaps to the real folder UI. Bind to
   *  `useDriveWorkspace().refetch`. */
  refetch?: () => void | Promise<void>;
  /** Per-folder permissions refetch — the workspace-wide `refetch`
   *  above doesn't touch `useMemberCaps` (its deps don't change on
   *  join), so a successful join wouldn't otherwise lift the cached
   *  "not a member" state. Bind to `useFolderPermissions(...).refetch`. */
  refetchPerms?: () => void;
}

export function RestrictedFolderCard({
  folderId,
  folderAlias,
  visibility,
  selfIdentity,
  refetch,
  refetchPerms,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // `joining` is local state spanning the WHOLE join flow (subgroup
  // join → resolve docs context → context join), not just one hook's
  // `loading` — the button must stay disabled until every step
  // settles.
  const [joining, setJoining] = useState(false);
  const { joinSubgroupInheritance } = useJoinSubgroupInheritance();
  const { joinContext } = useJoinContext();
  const { registryClient } = useDriveWorkspace();

  const isRestricted = visibility === 'Restricted';
  const isSyncing = visibility === undefined;
  // Open (definitive) → "Join folder". Undefined (syncing) → "Try
  // joining" — same action, softer copy.
  const showJoinCTA = visibility === 'Open' || visibility === undefined;

  const onCopy = async () => {
    if (!selfIdentity) return;
    try {
      await navigator.clipboard.writeText(selfIdentity);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const el = document.getElementById('restricted-identity-text');
      if (el instanceof HTMLInputElement) el.select();
    }
  };

  const onJoin = async () => {
    setError(null);
    setJoining(true);
    try {
      // 1) Materialise inherited subgroup membership (#2360):
      //    delivers the subgroup key + publishes `MemberJoinedOpen`
      //    on the namespace DAG.
      await joinSubgroupInheritance(folderId);

      // 2) Join the folder's docs CONTEXT. join-via-inheritance does
      //    NOT cascade into child contexts — without this step the
      //    node holds no owned `ContextIdentity` for the docs
      //    context, and every `execute` (list_docs, create_doc, …)
      //    fails with "No owned identity found for this context".
      //    `joinContext` writes that identity AND awaits core's
      //    internal context subscribe + sync, so once it resolves the
      //    docs context is queryable on this node.
      if (!registryClient) {
        throw new Error('Workspace registry not ready — try again.');
      }
      const docsContextId = await registryClient.getFolderContext({
        folder_id: folderId,
      });
      await joinContext(docsContextId);

      // Success: refetch workspace state AND the per-folder
      // permissions probe. The workspace refetch (folder list,
      // subgroups, etc.) does not touch useMemberCaps — its deps
      // `[mero, groupId, memberId]` are stable across the join, so
      // without `refetchPerms` the parent re-renders with the same
      // stale "not a member" error and the card never unmounts.
      refetchPerms?.();
      await refetch?.();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      // Common failure modes — all collapse to the same UX: wait +
      // retry, or ask admin. Core can surface "not a member of any
      // ancestor with Open chain", a 5xx from a still-syncing node,
      // or a transient KeyDelivery wait timeout.
      const isTransient =
        /not a member|has no group identity|HTTP 5|timeout/i.test(msg);
      setError(
        isTransient
          ? isSyncing
            ? "Workspace sync isn't quite there yet — visibility op still propagating. Try again in a moment."
            : "Your node can't reach this folder yet — either sync is still in progress or the workspace owner needs to add you. Try again, or ask the admin."
          : msg,
      );
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl rounded-lg border border-border bg-card p-6">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-md bg-muted p-2 text-muted-foreground">
          {isRestricted ? (
            <Lock className="h-4 w-4" />
          ) : isSyncing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <LogIn className="h-4 w-4" />
          )}
        </div>
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-foreground">
            {isRestricted
              ? 'This folder is restricted'
              : isSyncing
                ? 'Workspace is still syncing'
                : 'Join this open folder'}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {isRestricted ? (
              <>
                Only explicit members can see{' '}
                <span className="font-medium text-foreground">
                  {folderAlias}
                </span>
                's documents. Ask an owner to add you.
              </>
            ) : isSyncing ? (
              <>
                Your node hasn't received the visibility metadata for{' '}
                <span className="font-medium text-foreground">
                  {folderAlias}
                </span>{' '}
                yet — namespace governance typically propagates within
                a few seconds. Click <strong>Try joining</strong> to
                retry now.
              </>
            ) : (
              <>
                <span className="font-medium text-foreground">
                  {folderAlias}
                </span>{' '}
                is open to all workspace members. Click{' '}
                <strong>Join folder</strong> to materialize your access
                and start reading + editing.
              </>
            )}
          </p>

          {showJoinCTA && (
            <div className="mt-4 flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  void onJoin();
                }}
                disabled={joining}
                className="gap-1.5"
              >
                {joining ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Joining…
                  </>
                ) : isSyncing ? (
                  <>
                    <RotateCw className="h-3.5 w-3.5" />
                    Try joining
                  </>
                ) : (
                  <>
                    <LogIn className="h-3.5 w-3.5" />
                    Join folder
                  </>
                )}
              </Button>
              {refetch && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void refetch();
                  }}
                  className="gap-1.5"
                  disabled={joining}
                  title="Refetch workspace state"
                >
                  <RotateCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>
              )}
            </div>
          )}

          {error && (
            <p
              className="mt-2 text-xs text-destructive"
              role="alert"
            >
              {error}
            </p>
          )}

          {isRestricted && selfIdentity && (
            <div className="mt-4 space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">
                Your identity
              </label>
              <div className="flex gap-2">
                <input
                  id="restricted-identity-text"
                  readOnly
                  value={selfIdentity}
                  className="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onCopy}
                  aria-label="Copy identity"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Share this with the admin so they can add you.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
