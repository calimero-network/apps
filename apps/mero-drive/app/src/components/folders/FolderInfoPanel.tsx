// Folder details modal, opened from the folder's "⋯ → Info" item.
// Shows the folder name, its visibility (with the change toggle for
// those who can manage it), and the members/sharing controls — which
// previously lived in the main pane (FolderSharingPanel), and now have
// their home here since the pane is the document editor.
//
// Centered-modal pattern (matches NamespaceCreateDialog) rather than an
// anchored popover: the trigger is a dropdown-menu item that closes its
// own menu on select, so a modal avoids fighting the menu for focus.

import React, { useEffect, useRef, useState } from 'react';
import { X, Globe, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FolderSharingPanel } from './FolderSharingPanel';
import { FolderVisibilityToggle } from './FolderVisibilityToggle';

interface Props {
  folderId: string;
  folderAlias: string;
  currentVisibility: 'Open' | 'Restricted' | undefined;
  onClose: () => void;
}

export function FolderInfoPanel({
  folderId,
  folderAlias,
  currentVisibility,
  onClose,
}: Props) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [visError, setVisError] = useState<string | null>(null);

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="folder-info-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        ref={cardRef}
        tabIndex={-1}
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2
            id="folder-info-title"
            className="truncate text-base font-semibold text-foreground"
          >
            {folderAlias}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {currentVisibility === 'Restricted' ? (
              <>
                <Lock className="h-3.5 w-3.5" aria-hidden />
                Restricted — explicit members only
              </>
            ) : currentVisibility === 'Open' ? (
              <>
                <Globe className="h-3.5 w-3.5" aria-hidden />
                Open — all workspace members
              </>
            ) : (
              'Loading visibility…'
            )}
          </span>
          {/* Self-hides unless the caller can manage visibility. */}
          <FolderVisibilityToggle
            folderId={folderId}
            current={currentVisibility}
            onError={(err) => setVisError(err.message)}
          />
        </div>
        {visError && (
          <p className="px-4 pb-2 text-xs text-destructive" role="alert">
            {visError}
          </p>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <FolderSharingPanel folderId={folderId} />
        </div>
      </div>
    </div>
  );
}
