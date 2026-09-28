// Single-member row in NamespaceMembersPanel. One RoleSelect shows the
// role mapped from (core role, bitmask) and applies it through
// useGroupRoleAdmin; the bitmask comes from useGroupCapabilities, which
// stays reactive to SSE capability-change events.
//
// Permission-gating lives on the parent panel; this component trusts
// its caller for "should this row be interactive." The only UI
// visible to read-only viewers is the row itself with disabled
// select + no remove button.
//
// Inline-rename affordance: a pencil icon to the right of the
// <MemberLabel> opens a small input + ✓ / ✗ buttons, gated on the
// caller having CAN_MANAGE_METADATA (or being a core admin) AND the
// row not being the caller's own (self-edits go through the
// MyDisplayNamePanel above). Mirrors the FolderTreeItem rename UX.

import React, { useCallback, useRef, useState } from 'react';
import { Pencil, Check, X, Trash2 } from 'lucide-react';
import { useGroupCapabilities } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { MemberLabel } from '@/components/common/MemberLabel';
import {
  useAdminRenameMember,
  MAX_DISPLAY_NAME_LEN,
} from '@/hooks/useAdminRenameMember';
import { useContextEvents } from '@/hooks/useContextEvents';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useMemberDisplayName } from '@/hooks/useMemberDisplayName';
import { RoleSelect } from './RoleSelect';
import { useGroupRoleAdmin } from '@/hooks/useGroupRoleAdmin';
import {
  canChangeRole,
  describeRoleChange,
  parseGroupRole,
  roleDisplayLabel,
  workspaceRoleOf,
  WORKSPACE_ROLES,
  type WorkspaceAccessRole,
  type GroupRole,
} from '@/lib/roles';

interface Props {
  groupId: string;
  identity: string;
  /** Server-reported name or the shared unnamed fallback; MemberLabel's
   *  fallback and the remove dialog's text. */
  label: string;
  /** Server-reported core group role: Admin / Member / ReadOnly.
   *  Undefined if the caller didn't resolve it. */
  role?: string;
  /** The acting user's own role on this group, for the promote/demote gate. */
  actorRole: GroupRole;
  /** The acting user's own capability bitmask on this group. */
  actorCaps: number | null;
  /** How many Admins this group currently has - the last-admin guard. */
  adminCount: number;
  /** Called after a successful role change so the parent can refetch the
   *  roster (the badge, and the admin count, both move). */
  onAfterRoleChange?: () => void;
  /** True when this row is the caller's own identity - surfaces a
   *  "(you)" badge after the display name. */
  isSelf?: boolean;
  /** True for the workspace owner, whom the node never removes. */
  isOwner?: boolean;
  /** Presence hint only: the account behind it is self-asserted, so it gates nothing. */
  isPresent?: boolean;
  canManage: boolean;
  onRemove: (identity: string, label: string) => Promise<void>;
}

export function NamespaceMemberRow({
  groupId,
  identity,
  label,
  role,
  actorRole,
  actorCaps,
  adminCount,
  isSelf,
  isOwner = false,
  isPresent = false,
  canManage,
  onAfterRoleChange,
  onRemove,
}: Props) {
  const caps = useGroupCapabilities(groupId, identity);
  const { registryContextId } = useDriveWorkspace();
  const confirm = useConfirm();
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  // Caps change without a context event; the registry's sync run is the tick.
  //
  // Depend on `caps.refetch` (stable useCallback inside mero-react)
  // rather than the whole `caps` object - the object is a fresh
  // literal each render and would otherwise churn the SSE handler.
  const capsRefetch = caps.refetch;
  const onMemberEvent = useCallback(() => {
    void capsRefetch();
  }, [capsRefetch]);
  useContextEvents(registryContextId, onMemberEvent, { strict: true });

  // Admin-rename plumbing. In mero-docs a namespace's id IS its root
  // group id, and `groupId` is exactly that root for the namespace
  // members panel, so reuse it directly instead of re-deriving the
  // namespace id via useDriveWorkspace.
  const { canRename, renameTo } = useAdminRenameMember(groupId, identity);
  const { name: currentName, refetch: refetchName } = useMemberDisplayName(
    groupId,
    identity,
  );
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  // Re-entry guard for submitRename - Enter and the Save button
  // both call it, and Enter held / rapid double-click could
  // otherwise fire setMemberMetadata twice.
  const submitInFlightRef = useRef(false);

  const startRename = useCallback(() => {
    setRenameValue(currentName ?? '');
    setRenameError(null);
    setRenaming(true);
  }, [currentName]);

  const cancelRename = useCallback(() => {
    setRenaming(false);
    setRenameValue('');
    setRenameError(null);
  }, []);

  const submitRename = useCallback(async () => {
    if (submitInFlightRef.current) return;
    const next = renameValue.trim();
    if (!next) {
      cancelRename();
      return;
    }
    if (next === currentName) {
      cancelRename();
      return;
    }
    submitInFlightRef.current = true;
    setRenameSaving(true);
    setRenameError(null);
    try {
      await renameTo(next);
      await refetchName();
      setRenaming(false);
      setRenameValue('');
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setRenameError(err.message);
    } finally {
      submitInFlightRef.current = false;
      setRenameSaving(false);
    }
  }, [renameValue, currentName, renameTo, refetchName, cancelRename]);

  // --- Core group role (promote / demote) ---
  const currentRole = parseGroupRole(role);
  const currentAccess = workspaceRoleOf(currentRole, caps.capabilities);
  // `true`: this roster IS the workspace, so "Admin here" is the claim that
  // should also carry registry-manager rights. A folder roster passes false.
  const roleAdmin = useGroupRoleAdmin(groupId, true);
  const [roleWarnings, setRoleWarnings] = useState<string[]>([]);

  const roleVeto = useCallback(
    (nextRole: WorkspaceAccessRole): string | null => {
      const verdict = canChangeRole({
        nextRole,
        currentRole: currentAccess ?? 'Custom',
        isSelf: !!isSelf,
        actorRole,
        actorCaps,
        adminCount,
      });
      return verdict.allowed ? null : (verdict.reason ?? 'Not permitted.');
    },
    [currentAccess, isSelf, actorRole, actorCaps, adminCount],
  );

  const onRoleChange = async (nextRole: WorkspaceAccessRole) => {
    const veto = roleVeto(nextRole);
    if (veto || !currentAccess) {
      setUpdateError(veto);
      return;
    }
    const ok = await confirm({
      title: `Change ${currentName ?? label}'s role to ${roleDisplayLabel(nextRole)}?`,
      body: describeRoleChange(currentAccess, nextRole, 'workspace'),
      confirmLabel: 'Change role',
      destructive: true,
    });
    if (!ok) return;
    setUpdating(true);
    setUpdateError(null);
    setRoleWarnings([]);
    try {
      const result = await roleAdmin.setRole(
        identity,
        nextRole,
        caps.capabilities,
        currentRole,
      );
      setRoleWarnings(result.warnings);
      await capsRefetch();
      onAfterRoleChange?.();
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setUpdateError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  const onRemoveClick = async () => {
    const ok = await confirm(
      isSelf
        ? {
            title: 'Leave this workspace?',
            body: 'You will lose access to this workspace and need a new invite to come back.',
            confirmLabel: 'Leave',
            destructive: true,
          }
        : {
            title: 'Remove member?',
            body: (
              <>
                Remove <span className="font-medium">{label}</span> from this
                workspace?
              </>
            ),
            confirmLabel: 'Remove',
            destructive: true,
          },
    );
    if (!ok) return;
    setRemoving(true);
    try {
      await onRemove(identity, label);
    } finally {
      setRemoving(false);
    }
  };

  // Pencil shows only for non-self rows when the caller is admin /
  // has CAN_MANAGE_METADATA. The hook short-circuits these branches
  // (server enforces the same authz; this is just the UI gate).
  const showRenameAffordance = canRename && !isSelf;
  // The node refuses to remove the owner or the last admin, so neither is offered.
  const removable =
    canManage && !isOwner && !(currentRole === 'Admin' && adminCount <= 1);

  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          role="img"
          aria-label={isPresent ? 'Here now' : 'Away'}
          title={isPresent ? 'Here now' : 'Away'}
          className={`h-2 w-2 shrink-0 rounded-full border ${
            isPresent
              ? 'border-sync-synced bg-sync-synced'
              : 'border-muted-foreground/60 bg-transparent'
          }`}
        />
        <div className="min-w-0 flex-[1_1_8rem]">
          <div className="flex items-center gap-2">
            {renaming ? (
              <>
                <input
                  className="h-6 min-w-0 flex-1 rounded border border-input bg-background px-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  value={renameValue}
                  maxLength={MAX_DISPLAY_NAME_LEN}
                  autoFocus
                  disabled={renameSaving}
                  aria-label={`Rename ${label}`}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void submitRename();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                />
                <button
                  type="button"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  disabled={renameSaving}
                  aria-label="Save"
                  onClick={() => {
                    void submitRename();
                  }}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                  disabled={renameSaving}
                  aria-label="Cancel"
                  onClick={cancelRename}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </>
            ) : (
              <>
                <MemberLabel
                  namespaceId={groupId}
                  memberId={identity}
                  isSelf={isSelf}
                  fallback={() => label}
                  className="truncate font-medium text-foreground"
                />
                {showRenameAffordance && (
                  <button
                    type="button"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={`Rename ${label}`}
                    onClick={startRename}
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <RoleSelect
            value={currentAccess}
            options={WORKSPACE_ROLES}
            onChange={(next) => {
              void onRoleChange(next);
            }}
            reasonFor={roleVeto}
            disabled={!canManage || updating || roleAdmin.saving}
            ariaLabel={`Role for ${label}`}
          />
          {removable ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              disabled={removing}
              aria-label={`Remove ${label}`}
              onClick={onRemoveClick}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <span aria-hidden data-testid="remove-slot" className="h-7 w-7 shrink-0" />
          )}
        </div>
      </div>
      {renameError && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          Rename failed: {renameError}
        </p>
      )}
      {updateError && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          Role update failed: {updateError}
        </p>
      )}
      {roleWarnings.map((w) => (
        <p
          key={w}
          className="mt-1 text-xs text-amber-600 dark:text-amber-400"
          role="status"
        >
          {w}
        </p>
      ))}
      {caps.error && !updateError && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          Couldn't load role: {caps.error.message}
        </p>
      )}
    </li>
  );
}
