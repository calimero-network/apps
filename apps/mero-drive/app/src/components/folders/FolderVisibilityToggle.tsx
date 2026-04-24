// Toggle a folder between Inherit and Restricted visibility modes.
// Gated by canManageGroup — only folder admins see the option.
//
// Calls registry.setVisibility directly rather than going through
// useFolderOperations because it's a single-step, idempotent write
// that doesn't need the rollback machinery create/remove do.
// Failure is surfaced via a parent-supplied onError callback so the
// context-menu host decides how to render it.

import React, { useState } from 'react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Eye, EyeOff } from 'lucide-react';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';

interface Props {
  folderId: string;
  current: 'Inherit' | 'Restricted';
  onError?: (err: Error) => void;
}

export function FolderVisibilityToggle({ folderId, current, onError }: Props) {
  const { namespaceId } = useDriveWorkspace();
  const { registryClient } = useDriveWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  const [busy, setBusy] = useState(false);

  if (!perms.canManageGroup || !registryClient) return null;

  const next: 'Inherit' | 'Restricted' =
    current === 'Inherit' ? 'Restricted' : 'Inherit';

  const onToggle = async () => {
    setBusy(true);
    try {
      await registryClient.setVisibility({ id: folderId, visibility: next });
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      onError?.(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenuItem onClick={onToggle} disabled={busy}>
      {current === 'Inherit' ? (
        <>
          <EyeOff className="mr-2 h-4 w-4" />
          Make restricted
        </>
      ) : (
        <>
          <Eye className="mr-2 h-4 w-4" />
          Make inherited
        </>
      )}
    </DropdownMenuItem>
  );
}
