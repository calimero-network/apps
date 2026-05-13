// Single-member row in NamespaceMembersPanel. Binds MemberRoleSelect
// to useGroupCapabilities(groupId, identity) so reading the current
// bitmask and setting a new one both flow through the same hook —
// which in turn stays reactive to SSE capability-change events.
//
// Permission-gating lives on the parent panel; this component trusts
// its caller for "should this row be interactive." The only UI
// visible to read-only viewers is the row itself with disabled
// select + no remove button.

import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useGroupCapabilities } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { MemberLabel } from '@/components/common/MemberLabel';
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

  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <MemberLabel
              namespaceId={groupId}
              memberId={identity}
              isSelf={isSelf}
              fallback={() => label}
              className="truncate font-medium text-foreground"
            />
            {role && (
              <span
                className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${roleBadgeClasses(
                  role,
                )}`}
              >
                {role}
              </span>
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
