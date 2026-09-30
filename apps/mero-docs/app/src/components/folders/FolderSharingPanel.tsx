// Members + sharing controls for a single folder. Two layouts,
// branched on the folder's subgroup visibility (owned by core):
//
//   Restricted - explicit membership: add-by-identity / invite-link /
//     remove, plus (for owner/managers) a per-member folder-role
//     dropdown (RoleSelect: Manager / Editor / Read only).
//
//   Open - inherits membership from the workspace root: there's no
//     add (anyone in the workspace is already in), so we show "open to
//     all workspace members" copy instead, but STILL list the inherited
//     members with the folder-role dropdown and remove, so an admin can
//     pin someone to Read only or Manager, or take them out.
//
// Permission-gating (useFolderPermissions):
//   - canInviteMembers      → show the invite form (Restricted only)
//   - canManageMembers      → show the per-member remove button
//   - canManagePermissions  → show the folder-role dropdowns (the
//                             folder's core admin; a registry owner or
//                             manager is told why they cannot)
// Read-only viewers still see the members list.
//
// TODO: "Advanced" per-row expander (individual core-cap checkboxes +
// the Role radio) - a follow-up; today only the preset dropdown ships.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UserPlus, Link2, Globe, Trash2 } from 'lucide-react';
import { useMero } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useContextEvents } from '@/hooks/useContextEvents';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useFolderMembership } from '@/hooks/useFolderMembership';
import { useFolderRoles } from '@/hooks/useFolderRole';
import { useMemberName } from '@/hooks/useMemberName';
import { useCreateFolderInvite } from '@/hooks/useNamespaceInvitation';
import { InviteDialog } from '@/components/workspace/InviteDialog';
import { FolderMemberRoleRow } from '@/components/admin/FolderMemberRoleRow';
import { MemberLabel, UNNAMED_MEMBER_LABEL } from '@/components/common/MemberLabel';
import { MemberPicker } from '@/components/common/MemberPicker';
import type { Role } from '@/generated/registry/RegistryClient';
import {
  folderRoleOfRegistryRole,
  parseGroupRole,
  roleDisplayLabel,
} from '@/lib/roles';
import { looksLikeMemberIdentity } from '@/utils/validation';
import { folderLabel, folderNames } from '@/lib/folderLabel';
import { inheritReadOnly } from '@/lib/applyFolderRole';
import { clearOpenSubtree, removedFrom, restoreTo } from '@/lib/openFolderRemoval';

const OPEN_REMOVAL_NOTE =
  'They stay removed from it until you restore them here, even if they are invited to the workspace again.';

interface Props {
  folderId: string;
}

// Identity-format guard lives in utils/validation; see notes there
// (64-hex, client-only UX check).

export function FolderSharingPanel({ folderId }: Props) {
  const {
    namespaceId,
    folders,
    selfIdentity,
    registryContextId,
    registryClient,
    rootGroupId,
  } = useDriveWorkspace();
  const { mero } = useMero();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const { members, loading, error, add, refetch } =
    useFolderMembership(folderId);
  const { entries: roleEntries, refetch: refetchRoles } =
    useFolderRoles(folderId);
  const { create: createFolderInvite } = useCreateFolderInvite();
  // Live-refresh members + roles when remote admin ops land for
  // this folder (add/remove/role-change). The two refetches cover
  // the two independent stores backing the panel.
  const onFolderEvent = useCallback(() => {
    void refetch();
    void refetchRoles();
  }, [refetch, refetchRoles]);
  useContextEvents(registryContextId, onFolderEvent, { strict: true });
  const confirm = useConfirm();
  const [inviteLinkOpen, setInviteLinkOpen] = useState(false);

  const folder = folders.find((f) => f.id === folderId);
  const folderAlias = folderLabel(folder?.alias);
  // Only an explicit 'Open' visibility takes the open layout; anything
  // else (Restricted, or not-yet-resolved) keeps the explicit-members
  // layout, which is the safe default.
  const isOpenFolder = folder?.visibility === 'Open';

  // member identity → registry Role (default 'Editor' when absent).
  const roleByMember = useMemo(() => {
    const m = new Map<string, Role>();
    for (const e of roleEntries) m.set(e.member, e.role);
    return m;
  }, [roleEntries]);

  const [identity, setIdentity] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  // Per-row remove error - surfaced inline under the affected row
  // so the user sees which identity's removal failed and why,
  // rather than the error being swallowed to the console.
  const [removeError, setRemoveError] = useState<
    { identity: string; message: string } | null
  >(null);

  const trimmedIdentity = identity.trim();
  const canInvite =
    perms.canInviteMembers &&
    !!trimmedIdentity &&
    looksLikeMemberIdentity(trimmedIdentity) &&
    !members.some((m) => m.identity === trimmedIdentity) &&
    !inviting;

  const onInvite = async () => {
    if (!trimmedIdentity) {
      setInviteError('Member ID required');
      return;
    }
    if (!looksLikeMemberIdentity(trimmedIdentity)) {
      setInviteError('Doesn’t look like a valid member ID');
      return;
    }
    if (members.some((m) => m.identity === trimmedIdentity)) {
      setInviteError('Already a member');
      return;
    }
    setInviting(true);
    setInviteError(null);
    try {
      await add(trimmedIdentity);
      setIdentity('');
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setInviteError(err.message);
    } finally {
      setInviting(false);
    }
  };

  // Read only from the parent may have missed this Open folder: two admins can race
  // (one sets it above while another creates or opens this one). Its admin re-applies it.
  const parentId = folder?.parent_id ?? null;
  const reapplyReadOnly = perms.canManagePermissions && !!parentId && isOpenFolder;
  const reappliedFor = useRef<string | null>(null); // once per folder per mount
  useEffect(() => {
    if (!reapplyReadOnly || !parentId || !mero || !registryClient) return;
    if (reappliedFor.current === folderId) return;
    reappliedFor.current = folderId;
    const writer = { admin: mero.admin, registry: registryClient };
    // An admin who only inherits the folder is refused at the first core write,
    // before the registry row or caps are touched.
    inheritReadOnly(writer, parentId, folderId).catch((e: unknown) =>
      console.warn('[FolderSharingPanel] Read only not re-applied', e),
    );
  }, [reapplyReadOnly, parentId, folderId, mero, registryClient]);

  // Who an Open folder has removed: core bans them from it until an admin adds them back.
  const removedParent = folder?.parent_id ?? rootGroupId;
  const showRemoved = isOpenFolder && perms.canManageMembers;
  const [removed, setRemoved] = useState<string[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const refreshRemoved = useCallback(async () => {
    if (!showRemoved || !mero || !removedParent) return;
    try {
      const next = await removedFrom(mero.admin, removedParent, folderId);
      setRemoved((prev) => (prev.join() === next.join() ? prev : next));
    } catch (e: unknown) {
      console.warn('[FolderSharingPanel] removed members not read', e);
    }
  }, [showRemoved, mero, removedParent, folderId]);
  const memberKey = members.map((m) => m.identity).join();
  useEffect(() => {
    void refreshRemoved();
  }, [refreshRemoved, memberKey]);

  const onRestore = async (id: string) => {
    if (!mero || !registryClient || !removedParent) return;
    setRestoringId(id);
    try {
      await restoreTo(
        { admin: mero.admin, registry: registryClient },
        folders,
        removedParent,
        folderId,
        id,
      );
      await refetch();
    } catch (e: unknown) {
      setRemoveError({ identity: id, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRestoringId(null);
      void refreshRemoved();
    }
  };

  const onRemove = async (id: string) => {
    const leaving = !!selfIdentity && id === selfIdentity;
    const ok = await confirm(leaving ? {
      title: 'Leave this folder?',
      body: 'You will lose access to its documents and need a new invite to come back.',
      confirmLabel: 'Leave',
      destructive: true,
    } : {
      title: 'Remove member?',
      body: (
        <>
          Remove{' '}
          <MemberLabel
            namespaceId={namespaceId}
            memberId={id}
            className="font-medium"
          />
          {' '}from this folder?
          {isOpenFolder && ` ${OPEN_REMOVAL_NOTE}`}
        </>
      ),
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    setRemovingId(id);
    setRemoveError(null);
    try {
      if (!mero) throw new Error('Workspace not ready');
      // The admin client throws on a refusal, where the mero-react hook would not.
      await mero.admin.removeGroupMembers(folderId, { members: [id] });
      await refetch();
      if (id !== selfIdentity) {
        const failed = await clearOpenSubtree(mero.admin, folders, folderId, id);
        if (failed.length > 0) {
          setRemoveError({ identity: id, message: `still in ${folderNames(folders, failed)}` });
        }
        void refreshRemoved();
      }
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setRemoveError({ identity: id, message: err.message });
      // Refetch so the UI stays consistent with the node's actual
      // member list - remove() may have partially applied. Wrapped
      // in its own try/catch because the outer call is
      // fire-and-forget from the button's onClick; if refetch()
      // also fails (likely the same network issue that failed
      // remove), an uncaught throw would surface as an unhandled
      // promise rejection.
      try {
        await refetch();
      } catch (refetchErr) {
        console.warn(
          'refetch after remove failure also failed',
          refetchErr,
        );
      }
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <section
      aria-labelledby="sharing-heading"
      className="rounded-lg border border-border bg-card"
    >
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-2">
        <h3
          id="sharing-heading"
          className="text-sm font-semibold text-foreground"
        >
          Members
        </h3>
        {loading && (
          <span className="text-xs text-muted-foreground">Loading…</span>
        )}
      </header>

      {isOpenFolder && (
        <p className="flex items-start gap-2 border-b border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
          <Globe className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            Open to all workspace members. Anyone in the workspace can join
            and edit this folder. Use the role dropdowns below to pin a
            specific person to <strong>Read only</strong> or{' '}
            <strong>Manager</strong>.
          </span>
        </p>
      )}

      {perms.permissionsNeedOwner && (
        <p className="border-b border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
          Only this folder&apos;s owner can change roles.
        </p>
      )}

      {error && (
        <p
          className="border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-xs text-destructive"
          role="alert"
        >
          Failed to load members: {error.message}
        </p>
      )}

      <ul className="divide-y divide-border/40">
        {members.length === 0 && !loading && (
          <li className="px-4 py-3 text-xs text-muted-foreground">
            No members yet.
          </li>
        )}
        {members.map((m) => {
          const rowErr =
            removeError?.identity === m.identity ? removeError.message : null;
          const isSelfRow = !!selfIdentity && m.identity === selfIdentity;
          // In an Open folder core records a removal as a ban, so it sticks;
          // the node never removes a folder's owner (its core admin) or last admin.
          const removable =
            perms.canManageMembers &&
            parseGroupRole(m.role) !== 'Admin';
          if (perms.canManagePermissions) {
            return (
              <React.Fragment key={m.identity}>
                <FolderMemberRoleRow
                  folderId={folderId}
                  identity={m.identity}
                  coreRole={m.role}
                  registryRole={roleByMember.get(m.identity) ?? 'Editor'}
                  isSelf={isSelfRow}
                  canManage
                  onAfterRoleChange={refetchRoles}
                  onRemove={removable ? onRemove : undefined}
                  removing={removingId === m.identity}
                />
                {rowErr && (
                  <li className="px-4 pb-1 text-xs text-destructive" role="alert">
                    Remove failed: {rowErr}
                  </li>
                )}
              </React.Fragment>
            );
          }
          return (
            <ReadOnlyMemberRow
              key={m.identity}
              namespaceId={namespaceId}
              identity={m.identity}
              isSelf={isSelfRow}
              role={roleDisplayLabel(
                folderRoleOfRegistryRole(
                  parseGroupRole(m.role),
                  roleByMember.get(m.identity) ?? 'Editor',
                ),
              )}
              onRemove={removable ? () => onRemove(m.identity) : undefined}
              removing={removingId === m.identity}
              error={rowErr}
            />
          );
        })}
      </ul>

      {showRemoved && removed.length > 0 && (
        <div className="border-t border-border/60 px-4 py-2">
          <h4 className="text-xs font-medium text-muted-foreground">Removed</h4>
          <ul>
            {removed.map((id) => (
              <li key={id} className="flex items-center justify-between gap-3 py-1 text-sm">
                <MemberLabel namespaceId={namespaceId} memberId={id} className="truncate" />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={restoringId === id}
                  onClick={() => void onRestore(id)}
                >
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!isOpenFolder && perms.canInviteMembers && (
        <div className="space-y-3 border-t border-border/60 px-4 py-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Invite by member ID
            </label>
            <div className="flex items-start gap-2">
              <div className="flex-1">
                {/* Autocompletes against workspace members; existing
                    folder members are filtered out. Raw-paste of an
                    unknown pubkey still works via Enter - looksLike-
                    MemberIdentity validation runs unchanged in
                    onInvite below. */}
                <MemberPicker
                  namespaceId={namespaceId}
                  exclude={members.map((m) => m.identity)}
                  placeholder="member ID"
                  ariaLabel="member ID"
                  disabled={inviting}
                  onSelect={(id) => {
                    setIdentity(id);
                    setInviteError(null);
                  }}
                />
                {identity && (
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">
                    Selected:{' '}
                    <MemberLabel
                      namespaceId={namespaceId}
                      memberId={identity}
                      className="text-foreground"
                    />
                  </p>
                )}
              </div>
              <Button
                size="sm"
                onClick={onInvite}
                disabled={!canInvite}
                className="gap-1"
              >
                <UserPlus className="h-3.5 w-3.5" />
                {inviting ? 'Adding…' : 'Add'}
              </Button>
            </div>
            {inviteError && (
              <p className="mt-2 text-xs text-destructive">{inviteError}</p>
            )}
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Or share a link
            </label>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setInviteLinkOpen(true)}
              className="gap-1"
            >
              <Link2 className="h-3.5 w-3.5" />
              Invite to this folder only
            </Button>
          </div>
        </div>
      )}

      {inviteLinkOpen && (
        <InviteDialog
          title="Invite to folder"
          description={
            <>
              Share this link to add someone to{' '}
              <span className="font-medium text-foreground">{folderAlias}</span>
              {' '}only. They won't gain access to the rest of the
              workspace.
            </>
          }
          footnote="Scope: this folder only. Anyone with this link and a Calimero account can join."
          onCreate={() => createFolderInvite(folderId)}
          onClose={() => setInviteLinkOpen(false)}
        />
      )}
    </section>
  );
}

// Without canManagePermissions: the name and the member's folder role from the
// registry Role alone (caps are not fetched here), plus remove when allowed.
function ReadOnlyMemberRow({
  namespaceId,
  identity,
  isSelf,
  role,
  onRemove,
  removing,
  error,
}: {
  namespaceId: string | null;
  identity: string;
  isSelf: boolean;
  role: string;
  onRemove?: () => void;
  removing: boolean;
  error: string | null;
}) {
  const { name, settled } = useMemberName(namespaceId, identity);
  // Null while the name loads, so labels never call a named member unnamed.
  const label = name ?? (settled ? UNNAMED_MEMBER_LABEL : null);
  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">
            <MemberLabel namespaceId={namespaceId} memberId={identity} isSelf={isSelf} />
          </div>
          <div className="truncate text-xs text-muted-foreground">{role}</div>
        </div>
        {onRemove ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            disabled={removing}
            aria-label={label ? `Remove ${label}` : 'Remove member'}
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <span aria-hidden data-testid="remove-slot" className="h-7 w-7 shrink-0" />
        )}
      </div>
      {error && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          Remove failed: {error}
        </p>
      )}
    </li>
  );
}
