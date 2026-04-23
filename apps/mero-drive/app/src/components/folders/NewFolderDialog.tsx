// New-folder modal. Wraps useFolderOperations.create with a small
// form: alias + optional color + visibility toggle. Permission-gating
// lives on the button that opens this dialog — once here, the caller
// is authorised for this scope.
//
// Depth is capped at MAX_FOLDER_DEPTH (design-spec UX cap, not
// enforced server-side). The check runs against parentFolderId
// before render so the user sees the block up-front rather than
// after typing and submitting.

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { MAX_ALIAS_LENGTH, MAX_FOLDER_DEPTH } from '@/constants/config';
import { depthOf } from '@/utils/ancestry';
import { COLOR_ALLOWLIST } from '@/utils/validation';
import { useRegistry } from '@/context/RegistryContext';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useFolderOperations } from '@/hooks/useFolderOperations';

interface Props {
  parentFolderId: string | null;
  onClose: () => void;
}

export function NewFolderDialog({ parentFolderId, onClose }: Props) {
  const { namespaceId, rootGroupId } = useWorkspace();
  const { folders, registryClient } = useRegistry();
  const ops = useFolderOperations(
    registryClient,
    rootGroupId,
    folders.map((f) => ({
      id: f.id,
      parent_id: f.parent_id,
      visibility: f.visibility,
    })),
  );

  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [visibility, setVisibility] = useState<'Inherit' | 'Restricted'>('Inherit');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parentDepth = parentFolderId
    ? depthOf(
        folders.map((f) => ({ id: f.id, parent_id: f.parent_id })),
        parentFolderId,
      )
    : -1; // nothing parents a root-level folder; depth below is 0
  const newDepth = parentDepth + 1;
  const atDepthCap = newDepth >= MAX_FOLDER_DEPTH;

  const trimmed = name.trim();
  const trimmedColor = color.trim();
  const canSubmit =
    !!trimmed &&
    trimmed.length <= MAX_ALIAS_LENGTH &&
    !submitting &&
    !atDepthCap;

  const safeClose = () => {
    if (!submitting) onClose();
  };

  const onCreate = async () => {
    if (!namespaceId || !rootGroupId) {
      setError('Workspace not ready');
      return;
    }
    const alias = name.trim();
    if (!alias) {
      setError('Folder name required');
      return;
    }
    if (alias.length > MAX_ALIAS_LENGTH) {
      setError(`Folder name must be ${MAX_ALIAS_LENGTH} characters or fewer`);
      return;
    }
    if (trimmedColor && !COLOR_ALLOWLIST.test(trimmedColor)) {
      setError('Color must be hex (#rgb / #rgba / #rrggbb / #rrggbbaa) or rgb()/hsl()');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await ops.create({
        namespaceId,
        parentGroupId: parentFolderId ?? rootGroupId,
        alias,
        color: trimmedColor || null,
        visibility,
      });
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err.message);
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={safeClose}
    >
      <div
        className="w-96 rounded-lg border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-3 text-base font-semibold">
          {parentFolderId ? 'New subfolder' : 'New folder'}
        </h2>

        {atDepthCap ? (
          <div className="rounded border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            Folders can't be nested deeper than {MAX_FOLDER_DEPTH} levels.
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Name</span>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="Folder name"
                value={name}
                maxLength={MAX_ALIAS_LENGTH}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                disabled={submitting}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && canSubmit) onCreate();
                  if (e.key === 'Escape') safeClose();
                }}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">
                Color (optional)
              </span>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                placeholder="#3b82f6"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  setError(null);
                }}
                disabled={submitting}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-muted-foreground">Visibility</span>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={visibility}
                onChange={(e) =>
                  setVisibility(e.target.value as 'Inherit' | 'Restricted')
                }
                disabled={submitting}
              >
                <option value="Inherit">Inherit parent members</option>
                <option value="Restricted">Restricted (pick members later)</option>
              </select>
            </label>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={safeClose}
            disabled={submitting}
          >
            {atDepthCap ? 'Close' : 'Cancel'}
          </Button>
          {!atDepthCap && (
            <Button size="sm" onClick={onCreate} disabled={!canSubmit}>
              {submitting ? 'Creating…' : 'Create'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
