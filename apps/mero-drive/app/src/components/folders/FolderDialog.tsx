import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { X, Folder, Globe, Lock } from 'lucide-react';

const FOLDER_COLORS = [
  { id: 'default', name: 'Default', class: 'bg-amber-500' },
  { id: 'blue', name: 'Blue', class: 'bg-blue-500' },
  { id: 'green', name: 'Green', class: 'bg-green-500' },
  { id: 'red', name: 'Red', class: 'bg-red-500' },
  { id: 'purple', name: 'Purple', class: 'bg-purple-500' },
  { id: 'pink', name: 'Pink', class: 'bg-pink-500' },
  { id: 'orange', name: 'Orange', class: 'bg-orange-500' },
  { id: 'teal', name: 'Teal', class: 'bg-teal-500' },
];

export type FolderVisibilityChoice = 'open' | 'restricted';

interface FolderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, color: string | null, visibility?: FolderVisibilityChoice) => void;
  mode: 'create' | 'rename';
  initialName?: string;
  initialColor?: string | null;
  parentFolderName?: string | null;
  /** When true, shows an open/restricted visibility picker (for root folder creation). */
  showVisibility?: boolean;
  initialVisibility?: FolderVisibilityChoice;
}

export const FolderDialog: React.FC<FolderDialogProps> = ({
  isOpen,
  onClose,
  onSubmit,
  mode,
  initialName = '',
  initialColor = null,
  parentFolderName = null,
  showVisibility = false,
  initialVisibility = 'open',
}) => {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState<string | null>(initialColor);
  const [visibility, setVisibility] = useState<FolderVisibilityChoice>(initialVisibility);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setName(initialName);
      setColor(initialColor);
      setVisibility(initialVisibility);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen, initialName, initialColor, initialVisibility]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim()) {
      onSubmit(
        name.trim(),
        color === 'default' ? null : color,
        showVisibility ? visibility : undefined,
      );
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div 
        className="bg-card border border-border rounded-xl shadow-elevated p-6 w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Folder className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold">
              {mode === 'create' ? 'Create Folder' : 'Rename Folder'}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Parent folder info */}
        {mode === 'create' && parentFolderName && (
          <p className="text-sm text-muted-foreground mb-4">
            Creating subfolder in <strong>{parentFolderName}</strong>
          </p>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              Folder Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter folder name..."
              className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
              autoFocus
            />
          </div>

          {/* Color Picker */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-2">
              Folder Color
            </label>
            <div className="flex flex-wrap gap-2">
              {FOLDER_COLORS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`w-8 h-8 rounded-full ${c.class} transition-transform ${
                    (color === c.id || (!color && c.id === 'default'))
                      ? 'ring-2 ring-offset-2 ring-primary scale-110'
                      : 'hover:scale-105'
                  }`}
                  onClick={() => setColor(c.id)}
                  title={c.name}
                />
              ))}
            </div>
          </div>

          {/* Visibility Picker (root folders only) */}
          {showVisibility && mode === 'create' && (
            <div className="mb-6">
              <label className="block text-sm font-medium mb-2">
                Access
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    visibility === 'open'
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={() => setVisibility('open')}
                >
                  <Globe className="w-4 h-4" />
                  Open
                </button>
                <button
                  type="button"
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                    visibility === 'restricted'
                      ? 'border-amber-500 bg-amber-500/10 text-amber-500'
                      : 'border-border bg-background text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={() => setVisibility('restricted')}
                >
                  <Lock className="w-4 h-4" />
                  Restricted
                </button>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                {visibility === 'open'
                  ? 'Any workspace member with the right capability can join.'
                  : 'Only admins and allowlisted members can access.'}
              </p>
            </div>
          )}

          {/* Extra bottom spacing when visibility is not shown */}
          {!(showVisibility && mode === 'create') && <div className="mb-2" />}

          {/* Actions */}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {mode === 'create' ? 'Create' : 'Rename'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default FolderDialog;
