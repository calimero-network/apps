// The editor's top bar: back, the title field, undo/redo and the actions menu.
// Purely presentational - the title is a live input because it writes through
// the title CRDT on every keystroke, not on a commit.

import React from 'react';
import { Button } from '@/components/ui/button';
import {
  ChevronLeft,
  MoreHorizontal,
  FileText,
  Redo2,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** The live title field's binding; absent renders the title read-only. */
export interface TitleBinding {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSelect: () => void;
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
}

interface EditorHeaderProps {
  documentName: string;
  title?: TitleBinding;
  onDelete?: () => void;
  onBack?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export const EditorHeader: React.FC<EditorHeaderProps> = ({
  documentName,
  title,
  onDelete,
  onBack,
  onUndo,
  onRedo,
}) => (
  <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
    <div className="flex items-center gap-4">
      <Button variant="ghost" size="sm" className="gap-1.5" onClick={onBack}>
        <ChevronLeft className="w-4 h-4" />
        <span className="hidden sm:inline">Documents</span>
      </Button>
    </div>

    <div className="flex-1 flex justify-center px-4">
      {title ? (
        <div className="flex items-center gap-1.5 max-w-xs w-full">
          <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
          <input
            type="text"
            data-testid="doc-title-input"
            aria-label="Document title"
            ref={title.inputRef}
            value={title.value}
            onChange={title.onChange}
            onSelect={title.onSelect}
            className="w-full bg-transparent rounded px-2 py-1 text-center text-sm font-medium border border-transparent hover:border-border focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      ) : (
        <span className="text-sm font-medium flex items-center gap-1.5 text-foreground">
          <FileText className="w-4 h-4 text-muted-foreground" />
          {documentName}
        </span>
      )}
    </div>

    <div className="flex items-center gap-2">
      {onUndo && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          data-testid="doc-undo"
          aria-label="Undo"
          onClick={onUndo}
        >
          <Undo2 className="w-4 h-4" />
        </Button>
      )}
      {onRedo && (
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9"
          data-testid="doc-redo"
          aria-label="Redo"
          onClick={onRedo}
        >
          <Redo2 className="w-4 h-4" />
        </Button>
      )}
      {onDelete && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              aria-label="Document actions"
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Document
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  </header>
);
