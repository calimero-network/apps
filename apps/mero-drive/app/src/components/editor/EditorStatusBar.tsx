import React, { useState, useEffect } from 'react';
import { Shield, WifiOff, Users, Clock, FileText } from 'lucide-react';
import { Editor } from '@tiptap/react';

interface EditorStatusBarProps {
  editor: Editor | null;
  documentName: string;
}

type SyncStatus = 'synced' | 'syncing' | 'offline';

export const EditorStatusBar: React.FC<EditorStatusBarProps> = ({ 
  editor, 
  documentName 
}) => {
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('synced');
  const [lastSaved, setLastSaved] = useState<Date>(new Date());
  const [onlineUsers] = useState(1);

  // Simulate sync status changes when content updates
  useEffect(() => {
    if (!editor) return;

    const handleUpdate = () => {
      setSyncStatus('syncing');
      // Simulate sync completion
      const timeout = setTimeout(() => {
        setSyncStatus('synced');
        setLastSaved(new Date());
      }, 800);

      return () => clearTimeout(timeout);
    };

    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
    };
  }, [editor]);

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

  const getSyncStatusDisplay = () => {
    switch (syncStatus) {
      case 'synced':
        return (
          <div className="flex items-center gap-1.5 text-success">
            <div className="sync-indicator synced" />
            <span>Synced</span>
          </div>
        );
      case 'syncing':
        return (
          <div className="flex items-center gap-1.5 text-warning">
            <div className="sync-indicator syncing" />
            <span>Syncing...</span>
          </div>
        );
      case 'offline':
        return (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <WifiOff className="w-3.5 h-3.5" />
            <span>Offline</span>
          </div>
        );
    }
  };

  return (
    <div className="flex items-center justify-between px-4 py-2 border-t border-border/50 bg-muted/30 text-xs">
      {/* Left side - Document info */}
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

      {/* Right side - Status indicators */}
      <div className="flex items-center gap-4">
        {/* Last saved */}
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          <span>Last saved {formatTime(lastSaved)}</span>
        </div>

        {/* Online users */}
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Users className="w-3.5 h-3.5" />
          <span>{onlineUsers} online</span>
        </div>

        {/* Sync status */}
        {getSyncStatusDisplay()}

        {/* Encryption badge */}
        <div className="security-badge">
          <Shield className="w-3 h-3" />
          <span>E2E Encrypted</span>
        </div>
      </div>
    </div>
  );
};
