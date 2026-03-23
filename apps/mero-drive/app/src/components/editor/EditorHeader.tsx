import React, { useState } from 'react';
import { LogoWithText } from '@/components/icons/Logo';
import { Button } from '@/components/ui/button';
import { 
  ChevronLeft, 
  MoreHorizontal,
  FileText,
  Trash2
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface EditorHeaderProps {
  documentName: string;
  onDocumentNameChange: (name: string) => void;
  onDelete?: () => void;
  onBack?: () => void;
}

export const EditorHeader: React.FC<EditorHeaderProps> = ({
  documentName,
  onDocumentNameChange,
  onDelete,
  onBack,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(documentName);

  const handleNameSubmit = () => {
    if (editName.trim()) {
      onDocumentNameChange(editName.trim());
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSubmit();
    } else if (e.key === 'Escape') {
      setEditName(documentName);
      setIsEditing(false);
    }
  };

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
      {/* Left side */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onBack}>
          <ChevronLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Documents</span>
        </Button>
        
        <div className="hidden sm:block w-px h-6 bg-border" />
        
        <LogoWithText size={24} textClassName="text-base hidden sm:block" />
      </div>

      {/* Center - Document name */}
      <div className="flex-1 flex justify-center px-4">
        {isEditing ? (
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleKeyDown}
            className="bg-transparent border border-primary/50 rounded px-2 py-1 text-center text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 max-w-xs"
            autoFocus
          />
        ) : (
          <button
            onClick={() => {
              setEditName(documentName);
              setIsEditing(true);
            }}
            className="text-sm font-medium hover:text-primary transition-colors flex items-center gap-1.5"
          >
            <FileText className="w-4 h-4 text-muted-foreground" />
            {documentName}
          </button>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-2">
        {onDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
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
};
