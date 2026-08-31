// One member row inside FolderSharingPanel — name + the folder-scope
// FolderRoleSelect bound to that member's (registry Role, folder
// capability bitmask), plus an optional remove (×) button.
//
// The member's folder caps are read/written via
// useGroupCapabilities(folderId, member). The member's registry Role
// comes from the parent (joined off useFolderRoles) — members with no
// explicit row use the WASM default `Editor`. Selecting a preset
// writes BOTH: setFolderRole(folder_id, member, preset.role) and
// setCapabilities(preset.folderCaps).
//
// Permission-gating lives on the parent panel; this component trusts
// `canManage` for "is the dropdown / remove button interactive".
// Core group-admins bypass both the bitmask and the registry Role on
// the server, so for an Admin member we show an "All permissions"
// label instead of a (misleading) preset picker.

import React, { useCallback, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useGroupCapabilities } from '@calimero-network/mero-react';
import { Button } from '@/components/ui/button';
import { useContextEvents } from '@/hooks/useContextEvents';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { MemberLabel } from '@/components/common/MemberLabel';
import {
  FolderRoleSelect,
  type FolderRolePreset,
} from './FolderRoleSelect';
import type { Role } from '@/generated/registry/RegistryClient';

interface Props {
  folderId: string;
  identity: string;
  /** Pre-resolved label (server-reported `m.name` or a truncated
   *  pubkey). Used as the MemberLabel fallback for callers that
   *  haven't set a display name, and reused in remove dialogs. */
  label: string;
  /** Server-reported core role: Admin / Member / ReadOnly. */
  coreRole?: string;
  /** Registry folder Role for this member (default 'Editor' if absent). */
  registryRole: Role;
  /** True when this row is the caller's own identity — surfaces a
   *  "(you)" badge after the display name. */
  isSelf?: boolean;
  canManage: boolean;
  /** Called after the preset's registry role + folder caps are both
   *  written, so the parent can refetch the role list. */
  onAfterRoleChange?: () => void;
  /** Remove this member from the folder. Undefined hides the button. */
  onRemove?: (identity: string, label: string) => void;
  removing?: boolean;
}

export function FolderMemberRoleRow({
  folderId,
  identity,
  label,
  coreRole,
  registryRole,
  isSelf,
  canManage,
  onAfterRoleChange,
  onRemove,
  removing,
}: Props) {
  const { registryClient, namespaceId } = useDriveWorkspace();
  const caps = useGroupCapabilities(folderId, identity);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  // Live-refresh this row's capability bitmask when remote admin
  // ops land on the folder (an admin elsewhere changing this
  // member's caps). Same SSE connection that
  // FolderSharingPanel already opens — mero-react dedupes by
  // contextId set, so this is a free piggyback.
  //
  // Depend on `caps.refetch` (the stable useCallback inside
  // mero-react's useGroupCapabilities), NOT the whole `caps`
  // object — mero-react returns a fresh object literal each
  // render, which would otherwise churn the SSE handler identity.
  const capsRefetch = caps.refetch;
  const onCapsEvent = useCallback(() => {
    void capsRefetch();
  }, [capsRefetch]);
  useContextEvents(folderId, onCapsEvent);

  const onPreset = async (preset: FolderRolePreset) => {
    if (!registryClient) {
      setUpdateError('Registry not ready');
      return;
    }
    setUpdating(true);
    setUpdateError(null);
    try {
      await registryClient.setFolderRole({
        folder_id: folderId,
        member: identity,
        role: preset.role,
      });
      await caps.setCapabilities(preset.folderCaps);
      // `useGroupCapabilities.setCapabilities` resolves with the new
      // bitmask but mero-react does NOT necessarily update the hook's
      // own `capabilities` state until the next read — and the
      // FolderRoleSelect's "current preset" derives from that value.
      // Explicitly refetching keeps the dropdown label honest after
      // the write lands.
      await caps.refetch();
      onAfterRoleChange?.();
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setUpdateError(err.message);
    } finally {
      setUpdating(false);
    }
  };

  return (
    <li className="px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-foreground">
            <MemberLabel
              namespaceId={namespaceId}
              memberId={identity}
              isSelf={isSelf}
              fallback={() => label}
            />
          </div>
          <div className="truncate text-xs text-muted-foreground">
            <code>{identity.slice(0, 12)}…</code>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {coreRole === 'Admin' ? (
            <span className="text-xs text-muted-foreground">
              All permissions
            </span>
          ) : (
            <FolderRoleSelect
              role={registryRole}
              folderCaps={
                caps.capabilities ??
                // While loading OR on a caps-fetch error, pass `null` so
                // FolderRoleSelect renders its "Loading…" state instead
                // of misleading the user with a `0` that would match the
                // Viewer/Editor preset (both have `folderCaps: 0`).
                // Passing `0` on error also lets a "change" click write
                // `setCapabilities(0)` — a no-op that silently swallows
                // the underlying error.
                (caps.loading || caps.error ? null : 0)
              }
              onChange={onPreset}
              disabled={!canManage || updating || caps.loading || !!caps.error}
              ariaLabel={`Folder role for ${label}`}
            />
          )}
          {onRemove && canManage && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              disabled={removing}
              aria-label={`Remove ${label}`}
              onClick={() => onRemove(identity, label)}
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
          Couldn't load folder caps: {caps.error.message}
        </p>
      )}
    </li>
  );
}
