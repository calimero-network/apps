// 100% presentational status bar. Decoupled from any editor library —
// word/character counts arrive as plain props (the BlockNote shell
// derives them from `editor.document` via blocksToPlainText), so this
// file no longer imports Tiptap.

import React from 'react';
import { Shield, AlertCircle, FileText, WifiOff } from 'lucide-react';
import type { SaveStatus } from './types';
import { useSettledSaveStatus } from './useSettledSaveStatus';

interface EditorStatusBarProps {
  documentName: string;
  /** Word / character counts derived by the editor shell. */
  wordCount?: number;
  charCount?: number;
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  isAppReady?: boolean;
}

export const EditorStatusBar: React.FC<EditorStatusBarProps> = ({
  documentName,
  wordCount = 0,
  charCount = 0,
  saveStatus,
  lastSavedAt,
  isAppReady = true,
}) => {
  const shownStatus = useSettledSaveStatus(saveStatus);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getSaveStatusDisplay = () => {
    if (!isAppReady) {
      return (
        <div className="flex items-center gap-1.5 text-muted-foreground" data-testid="save-status">
          <WifiOff className="w-3.5 h-3.5" />
          <span>Offline</span>
        </div>
      );
    }

    switch (shownStatus) {
      case 'saved':
        return (
          <div
            className="flex items-center gap-1.5 text-success"
            data-testid="save-status"
            title={lastSavedAt ? `Last saved ${formatTime(lastSavedAt)}` : undefined}
          >
            <div className="w-2 h-2 rounded-full bg-current opacity-80" />
            <span>Saved</span>
          </div>
        );
      case 'saving':
        return (
          <div className="flex items-center gap-1.5 text-warning" data-testid="save-status">
            <div className="w-2 h-2 rounded-full bg-current animate-pulse" />
            <span>Saving…</span>
          </div>
        );
      case 'error':
        return (
          <div className="flex items-center gap-1.5 text-destructive" data-testid="save-status">
            <AlertCircle className="w-3.5 h-3.5" />
            <span>Save failed</span>
          </div>
        );
    }
  };

  return (
    // Nothing wraps: on a narrow window the lesser items drop out instead.
    <div className="flex items-center justify-between gap-4 whitespace-nowrap px-4 py-2 border-t border-border/50 bg-muted/30 text-xs">
      <div className="flex min-w-0 items-center gap-4">
        <div className="hidden min-w-0 items-center gap-1.5 text-muted-foreground lg:flex">
          <FileText className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{documentName}</span>
        </div>
        <div className="hidden items-center gap-1.5 text-muted-foreground md:flex">
          <span>{wordCount} words</span>
          <span className="text-border">•</span>
          <span>{charCount} characters</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {getSaveStatusDisplay()}

        <div className="security-badge">
          <Shield className="w-3 h-3" />
          <span>E2E Encrypted</span>
        </div>
      </div>
    </div>
  );
};
