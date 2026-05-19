// Namespace-level members list — shows every member of the
// namespace root group with their current role and an admin-only
// remove affordance. Individual member rows fetch + mutate their
// capability bitmask via useGroupCapabilities so the row stays
// reactive to role changes from other tabs / peers.
//
// The invite flow lives in FolderSharingPanel for per-folder
// membership; namespace-wide invites happen elsewhere (via
// useCreateNamespaceInvitation — surfaced in a future settings
// view, tracked separately).

import React, { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderMembership } from '@/hooks/useFolderMembership';
import { useNamespacePermissions } from '@/hooks/useNamespacePermissions';
import { NamespaceMemberRow } from '@/components/admin/NamespaceMemberRow';
import { InviteDialog } from './InviteDialog';
import { useCreateNamespaceInvite } from '@/hooks/useNamespaceInvitation';

export function NamespaceMembersPanel() {
  const { namespaceId, rootGroupId, namespaces, selfIdentity } =
    useDriveWorkspace();
  const perms = useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '');
  const membership = useFolderMembership(rootGroupId);
  const { create: createInvite } = useCreateNamespaceInvite();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const currentNamespace = namespaces.find(
    (n) => n.namespaceId === namespaceId,
  );
  const aliasLabel =
    currentNamespace?.name ??
    (namespaceId ? `${namespaceId.slice(0, 8)}…` : 'this workspace');

  // Read-only viewers see the panel but can't mutate. We don't
  // hide the whole panel because knowing who's in the workspace
  // is legitimately useful even without admin rights.
  const onRemove = async (identity: string, label: string) => {
    setRemoveError(null);
    try {
      await membership.remove(identity);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setRemoveError(`Couldn't remove ${label}: ${err.message}`);
      // Refetch to make sure the UI reflects the node's state if
      // the remove partially applied.
      try {
        await membership.refetch();
      } catch {
        // swallow — outer refetch is best-effort.
      }
    }
  };

  if (!rootGroupId) return null;

  return (
    <section
      aria-labelledby="namespace-members-heading"
      className="rounded-lg border border-border bg-card"
    >
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3">
        <div>
          <h3
            id="namespace-members-heading"
            className="text-sm font-semibold text-foreground"
          >
            Namespace members
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            People with access to this workspace.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {membership.loading && (
            <span className="text-xs text-muted-foreground">Loading…</span>
          )}
          {perms.canInviteMembers && namespaceId && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setInviteOpen(true)}
            >
              <UserPlus className="mr-1.5 h-3.5 w-3.5" />
              Invite
            </Button>
          )}
        </div>
      </header>

      {membership.error && (
        <p
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          Failed to load members: {membership.error.message}
        </p>
      )}

      {removeError && (
        <p
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          {removeError}
        </p>
      )}

      <ul className="divide-y divide-border/40">
        {membership.members.length === 0 && !membership.loading && (
          <li className="px-4 py-3 text-xs text-muted-foreground">
            No members yet.
          </li>
        )}
        {membership.members.map((m) => (
          <NamespaceMemberRow
            key={m.identity}
            groupId={rootGroupId}
            identity={m.identity}
            label={m.name ?? `${m.identity.slice(0, 8)}…`}
            role={m.role}
            isSelf={!!selfIdentity && m.identity === selfIdentity}
            canManage={perms.canManageMembers}
            onRemove={onRemove}
          />
        ))}
      </ul>

      {inviteOpen && namespaceId && (
        <InviteDialog
          title="Invite to workspace"
          description={
            <>
              Share this link with people you want to give access to{' '}
              <span className="font-medium text-foreground">{aliasLabel}</span>
              . They'll be added to the workspace root and will see every
              folder that inherits from it.
            </>
          }
          footnote="Anyone with this link and a Calimero identity can join the workspace."
          onCreate={() => createInvite(namespaceId)}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </section>
  );
}
