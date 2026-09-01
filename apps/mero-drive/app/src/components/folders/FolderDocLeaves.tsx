// Document leaves for ONE expanded folder. Mounted by FolderTreeItem
// only while its folder is expanded, so useDocs(folderId) — which
// resolves a per-folder Calimero context — fires lazily rather than
// for every folder in the tree on load. Collapsing the folder
// unmounts this and releases the subscription.

import React from 'react';
import { FileText } from 'lucide-react';
import { useDocs } from '@/hooks/useDocs';

interface Props {
  folderId: string;
  selectedDocId: string | null;
  onOpenDoc: (folderId: string, docId: string) => void;
}

export function FolderDocLeaves({
  folderId,
  selectedDocId,
  onOpenDoc,
}: Props) {
  const docs = useDocs(folderId);

  // Context not yet bound: a brief muted hint, never a red error —
  // folders sync from peers and the context lands a moment later.
  if (!docs.contextId) {
    if (docs.error) return null; // access-denied / no membership: silent
    if (docs.contextResolving) {
      return (
        <li className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
          {/* Chevron-width spacer so the hint lines up with doc rows. */}
          <span className="h-4 w-4 shrink-0" aria-hidden />
          Syncing…
        </li>
      );
    }
    return null;
  }

  if (docs.error) return null;
  if (docs.loading && docs.list.length === 0) return null;

  return (
    <>
      {docs.list.map((d) => {
        const isSelected = d.id === selectedDocId;
        return (
          <li key={d.id}>
            <button
              type="button"
              onClick={() => onOpenDoc(folderId, d.id)}
              className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                isSelected
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'text-foreground hover:bg-muted/60'
              }`}
            >
              {/* Spacer matching the folder row's chevron column so doc
                  icons align under sibling subfolder icons. */}
              <span className="h-4 w-4 shrink-0" aria-hidden />
              <FileText
                className={`h-3.5 w-3.5 shrink-0 ${
                  isSelected ? 'text-primary' : 'text-muted-foreground'
                }`}
                aria-hidden
              />
              <span className="truncate">{d.title || 'Untitled'}</span>
            </button>
          </li>
        );
      })}
    </>
  );
}
