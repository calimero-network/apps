// Namespace-level members list - shows every member of the
// namespace root group with their current role and an admin-only
// remove affordance. Individual member rows fetch + mutate their
// capability bitmask via useGroupCapabilities so the row stays
// reactive to role changes from other tabs / peers.
//
// The invite flow lives in FolderSharingPanel for per-folder
// membership; namespace-wide invites happen elsewhere (via
// useCreateNamespaceInvitation - surfaced in a future settings
// view, tracked separately).

import React, { useMemo, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { useMero } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { namespaceLabel } from '@/lib/namespaceLabel';
import { folderLabel } from '@/lib/folderLabel';
import { removeFromFolders } from '@/lib/removeFromFolders';
import { useFolderMembership } from '@/hooks/useFolderMembership';
import { useNamespacePermissions } from '@/hooks/useNamespacePermissions';
import { NamespaceMemberRow } from '@/components/admin/NamespaceMemberRow';
import { UNNAMED_MEMBER_LABEL } from '@/components/common/MemberLabel';
import { useMemberCaps } from '@/hooks/useMemberCaps';
import { countAdmins, parseGroupRole } from '@/lib/roles';
import { InviteDialog } from './InviteDialog';
import { useCreateNamespaceInvite } from '@/hooks/useNamespaceInvitation';
import { useWorkspacePresence } from '@/hooks/useWorkspacePresence';

export function NamespaceMembersPanel() {
  const {
    namespaceId,
    rootGroupId,
    namespaces,
    selfIdentity,
    registryContextId,
    registryAdmin,
    folders,
  } = useDriveWorkspace();
  const { mero } = useMero();
  const perms = useNamespacePermissions(namespaceId ?? '', rootGroupId ?? '');
  const membership = useFolderMembership(rootGroupId);
  const memberIds = useMemo(
    () => membership.members.map((m) => m.identity),
    [membership.members],
  );
  const present = useWorkspacePresence(
    registryContextId,
    selfIdentity,
    memberIds,
  );
  // The acting user's own role + bitmask on this group. Each row needs both to
  // decide which promotions it may offer, and re-deriving them per row would
  // fan N identical probes across an N-member roster.
  const selfCaps = useMemberCaps(namespaceId ?? '', rootGroupId ?? '');
  const selfRow = membership.members.find((m) => m.identity === selfIdentity);
  // Prefer the roster's own answer; fall back to `useMemberCaps`'s admin
  // short-circuit for the window before the roster lands, so an admin's
  // controls are not briefly disabled on first paint.
  const actorRole = selfRow
    ? parseGroupRole(selfRow.role)
    : selfCaps.isAdmin
      ? 'Admin'
      : 'Member';
  // The last-admin guard is only as good as the list it counts. An empty or
  // still-loading roster would report 0 admins and make every demotion look
  // safe, so treat "not loaded yet" as "at least this many" by counting only
  // once there are rows to count.
  const adminCount = countAdmins(membership.members);
  const { create: createInvite } = useCreateNamespaceInvite();
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  const currentNamespace = namespaces.find(
    (n) => n.namespaceId === namespaceId,
  );
  const aliasLabel = namespaceId
    ? namespaceLabel(currentNamespace?.name)
    : 'this workspace';

  // Read-only viewers see the panel but can't mutate. We don't
  // hide the whole panel because knowing who's in the workspace
  // is legitimately useful even without admin rights.
  const onRemove = async (identity: string, label: string) => {
    setRemoveError(null);
    try {
      if (!mero || !rootGroupId) throw new Error('Workspace not ready');
      // The admin client throws on a refusal, where the mero-react hook would not.
      await mero.admin.removeGroupMembers(rootGroupId, { members: [identity] });
      await membership.refetch();
      if (identity === selfIdentity) return;
      const failed = await removeFromFolders(mero.admin, folders.map((f) => f.id), identity);
      if (failed.length > 0) {
        const names = failed.map((id) => folderLabel(folders.find((f) => f.id === id)?.alias));
        setRemoveError(
          `Removed ${label} from the workspace, but not from ${names.join(', ')}. Ask the owner of each to remove them.`,
        );
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setRemoveError(`Couldn't remove ${label}: ${err.message}`);
      // Refetch to make sure the UI reflects the node's state if
      // the remove partially applied.
      try {
        await membership.refetch();
      } catch {
        // swallow - outer refetch is best-effort.
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
            Workspace members
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
            label={m.name ?? UNNAMED_MEMBER_LABEL}
            role={m.role}
            actorRole={actorRole}
            actorCaps={selfCaps.caps}
            adminCount={adminCount}
            isSelf={!!selfIdentity && m.identity === selfIdentity}
            isOwner={m.identity === registryAdmin.owner}
            isPresent={present.has(m.identity)}
            canManage={perms.canManageMembers}
            onAfterRoleChange={() => {
              void membership.refetch();
            }}
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
              . They'll join the workspace and see every folder that is open
              to all workspace members.
            </>
          }
          footnote="Anyone with this link and a Calimero account can join the workspace."
          onCreate={() => createInvite(namespaceId)}
          onClose={() => setInviteOpen(false)}
        />
      )}
    </section>
  );
}
