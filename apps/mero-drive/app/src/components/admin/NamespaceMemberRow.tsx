// Single-member row in NamespaceMembersPanel. Binds MemberRoleSelect
// to useGroupCapabilities(groupId, identity) so reading the current
// bitmask and setting a new one both flow through the same hook —
// which in turn stays reactive to SSE capability-change events.
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
import { useMemberDisplayName } from '@/hooks/useMemberDisplayName';
import { MemberRoleSelect } from './MemberRoleSelect';

interface Props {
  groupId: string;
  identity: string;
  /** Pre-resolved label (e.g. server-reported `m.name`, or a
   *  truncated pubkey). Used as the MemberLabel fallback so a member
   *  with no display name still gets the parent panel's chosen text;
   *  also reused for the "Remove member?" confirm dialog. */
  label: string;
  /** Server-reported role: Admin / Member / ReadOnly. Undefined if
   *  the caller didn't resolve it. */
  role?: string;
  /** True when this row is the caller's own identity — surfaces a
   *  "(you)" badge after the display name. */
  isSelf?: boolean;
  canManage: boolean;
  onRemove: (identity: string, label: string) => Promise<void>;
}

// Role → Tailwind badge classes. Admin is emphasised; the others
// stay low-contrast so the list reads as a roster, not a traffic
// light.
function roleBadgeClasses(role: string | undefined): string {
  switch (role) {
    case 'Admin':
      return 'bg-primary/10 text-primary border-primary/30';
    case 'ReadOnly':
      return 'bg-muted text-muted-foreground border-border';
    case 'Member':
    default:
      return 'bg-accent text-accent-foreground border-border';
  }
}

export function NamespaceMemberRow({
  groupId,
  identity,
  label,
  role,
  isSelf,
  canManage,
  onRemove,
}: Props) {
  const caps = useGroupCapabilities(groupId, identity);
  const confirm = useConfirm();
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  // Live-refresh this row's capability bitmask + display name when
  // remote ops land for this namespace (an admin elsewhere editing
  // the same member). The display-name refetch is wrapped below
  // because `refetchName` is captured later.
  //
  // Depend on `caps.refetch` (stable useCallback inside mero-react)
  // rather than the whole `caps` object — the object is a fresh
  // literal each render and would otherwise churn the SSE handler.
  const capsRefetch = caps.refetch;
  const onMemberEvent = useCallback(() => {
    void capsRefetch();
  }, [capsRefetch]);
  useContextEvents(groupId, onMemberEvent);

  // Admin-rename plumbing. In mero-drive a namespace's id IS its root
  // group id, and `groupId` is exactly that root for the namespace
  // members panel — so reuse it directly instead of re-deriving via
  // useDriveWorkspace (avoids a redundant context subscription and
  // keeps the row's data flow purely prop-driven so it stays
  // testable in isolation).
  const { canRename, renameTo } = useAdminRenameMember(groupId, identity);
  const { name: currentName, refetch: refetchName } = useMemberDisplayName(
    groupId,
    identity,
  );
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  // Re-entry guard for submitRename — Enter and the Save button
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

  const onRoleChange = async (nextMask: number) => {
    setUpdating(true);
    setUpdateError(null);
    try {
      await caps.setCapabilities(nextMask);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setUpdateError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  const onRemoveClick = async () => {
    const ok = await confirm({
      title: 'Remove member?',
      body: (
        <>
          Remove <code className="text-xs">{label}</code> from this
          namespace?
        </>
      ),
      confirmLabel: 'Remove',
      destructive: true,
    });
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

  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
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
                {role && (
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${roleBadgeClasses(
                      role,
                    )}`}
                  >
                    {role}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            <code>{identity.slice(0, 12)}…</code>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {role === 'Admin' ? (
            // Admins bypass the cap bitmask entirely on the server
            // (is_group_admin_or_has_capability short-circuits role
            // === Admin to "all caps allowed"), so exposing a
            // cap-preset picker here would suggest a choice that
            // wouldn't actually take effect. The role badge to the
            // left already communicates the privilege level.
            <span className="text-xs text-muted-foreground">
              All permissions
            </span>
          ) : (
            <MemberRoleSelect
              value={caps.capabilities}
              onChange={onRoleChange}
              disabled={!canManage || updating || caps.loading}
              ariaLabel={`Role for ${label}`}
            />
          )}
          {canManage && (
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
      {caps.error && !updateError && (
        <p className="mt-1 text-xs text-destructive" role="alert">
          Couldn't load role: {caps.error.message}
        </p>
      )}
    </li>
  );
}
