// Folder details modal, opened from the folder's "⋯ → Info" item.
// Shows the folder name, its visibility (with the change toggle for
// those who can manage it), and the members/sharing controls — which
// previously lived in the main pane (FolderSharingPanel), and now have
// their home here since the pane is the document editor.
//
// Centered modal rather than an anchored popover: the trigger closes its
// own dropdown menu on select, so a modal avoids fighting it for focus.

import React, { useState } from 'react';
import { X, Globe, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
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
  const [visError, setVisError] = useState<string | null>(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        className="flex flex-col overflow-hidden p-0"
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <DialogTitle className="truncate text-foreground">
            {folderAlias}
          </DialogTitle>
          <DialogClose asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </DialogClose>
        </header>

        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-4 py-3">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {currentVisibility === 'Restricted' ? (
              <>
                <Lock className="h-3.5 w-3.5" aria-hidden />
                Restricted: only invited members
              </>
            ) : currentVisibility === 'Open' ? (
              <>
                <Globe className="h-3.5 w-3.5" aria-hidden />
                Open: all workspace members
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
      </DialogContent>
    </Dialog>
  );
}
