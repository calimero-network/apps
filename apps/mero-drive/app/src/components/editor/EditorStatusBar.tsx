import React from 'react';
import { Shield, AlertCircle, Clock, FileText, WifiOff } from 'lucide-react';
import { Editor } from '@tiptap/react';
import type { SaveStatus } from './DocumentEditor';

interface EditorStatusBarProps {
  editor: Editor | null;
  documentName: string;
  saveStatus: SaveStatus;
  lastSavedAt: Date | null;
  isAppReady?: boolean;
}

export const EditorStatusBar: React.FC<EditorStatusBarProps> = ({ 
  editor, 
  documentName,
  saveStatus,
  lastSavedAt,
  isAppReady = true,
}) => {
  const getWordCount = () => {
    if (!editor) return 0;
    const text = editor.state.doc.textContent;
    return text.split(/\s+/).filter(word => word.length > 0).length;
  };

  const getCharacterCount = () => {
    if (!editor) return 0;
    return editor.state.doc.textContent.length;
  };

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

    switch (saveStatus) {
      case 'saved':
        return (
          <div className="flex items-center gap-1.5 text-success" data-testid="save-status">
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
      case 'unsaved':
        return (
          <div className="flex items-center gap-1.5 text-muted-foreground" data-testid="save-status">
            <div className="w-2 h-2 rounded-full bg-current animate-pulse" />
            <span>Unsaved changes</span>
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
    <div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-muted/30 text-xs">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <FileText className="w-3.5 h-3.5" />
          <span>{documentName}</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <span>{getWordCount()} words</span>
          <span className="text-border">•</span>
          <span>{getCharacterCount()} characters</span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        {lastSavedAt && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span>Last saved {formatTime(lastSavedAt)}</span>
          </div>
        )}

        {getSaveStatusDisplay()}

        <div className="security-badge">
          <Shield className="w-3 h-3" />
          <span>E2E Encrypted</span>
        </div>
      </div>
    </div>
  );
};
