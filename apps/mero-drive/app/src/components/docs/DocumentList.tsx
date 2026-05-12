// List of docs in a folder + a permission-gated "New document"
// button. Selection is owned by the parent (WorkspaceLayout) so
// switching folders can reset it and the editor reads the same
// id. Clicking a doc calls `onOpen(id)`.
//
// Create flow is inline: click "New document" → useDocs.create
// with a default title "Untitled" → onOpen(newId) so the editor
// opens on the freshly-created doc for immediate editing.

import React, { useState } from 'react';
import { FileText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDriveWorkspace } from '@/hooks/useDriveWorkspace';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useDocs } from '@/hooks/useDocs';

interface Props {
  folderId: string;
  selectedDocId: string | null;
  onOpen: (docId: string) => void;
}

export function DocumentList({ folderId, selectedDocId, onOpen }: Props) {
  const { namespaceId } = useDriveWorkspace();
  const perms = useFolderPermissions(namespaceId ?? '', folderId);
  // TODO(phase-c-part-3): gate on useFolderRole — creating/editing docs
  // is the registry `Role`, not a cap bit. Until then any folder member
  // can create docs.
  const canEditDocs = perms.isMember;
  const docs = useDocs(folderId);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const onCreate = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const newId = await docs.create({ title: 'Untitled' });
      onOpen(newId);
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      setCreateError(err.message);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b border-border/60 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Documents
        </span>
        {canEditDocs && docs.contextId && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={creating}
            onClick={onCreate}
          >
            <Plus className="h-3.5 w-3.5" />
            {creating ? 'Creating…' : 'New'}
          </Button>
        )}
      </header>

      {createError && (
        <p
          className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs text-destructive"
          role="alert"
        >
          Create failed: {createError}
        </p>
      )}

      {!docs.contextId && !docs.error && (
        <div className="p-3 text-xs text-muted-foreground">
          This folder has no docs context bound yet.
        </div>
      )}

      {docs.error && (
        <div className="p-3 text-xs text-destructive">
          Failed to load docs: {docs.error.message}
        </div>
      )}

      {docs.loading && docs.contextId && (
        <div className="p-3 text-xs text-muted-foreground">Loading…</div>
      )}

      {docs.contextId && !docs.loading && docs.list.length === 0 && (
        <div className="p-3 text-xs text-muted-foreground">
          {canEditDocs
            ? 'No documents yet. Click New to create one.'
            : 'No documents yet.'}
        </div>
      )}

      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {docs.list.map((d) => {
          const isSelected = d.id === selectedDocId;
          return (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => onOpen(d.id)}
                className={`flex w-full items-center gap-2 truncate rounded px-2 py-1.5 text-left text-sm ${
                  isSelected
                    ? 'bg-primary/10 text-primary'
                    : 'text-foreground hover:bg-muted'
                }`}
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{d.title || 'Untitled'}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
