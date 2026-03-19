import React, { useState } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import { FolderContextManager } from '@/api/FolderContextManager';
import { FolderRegistryEntry } from '@/api/AbiClient';
import { Button } from '@/components/ui/button';
import { X, Loader2, Trash2 } from 'lucide-react';

interface FolderSettingsPanelProps {
  folder: FolderRegistryEntry;
  groupId: string;
  generalContextId: string;
  isOpen: boolean;
  onClose: () => void;
  onRenamed: (contextId: string, newName: string) => void;
  onDeleted: (contextId: string) => void;
}

export const FolderSettingsPanel: React.FC<FolderSettingsPanelProps> = ({
  folder,
  groupId,
  generalContextId,
  isOpen,
  onClose,
  onRenamed,
  onDeleted,
}) => {
  const { app } = useCalimero();

  const [name, setName] = useState(folder.name);
  const [visibility, setVisibility] = useState<'open' | 'restricted'>('open');
  const [isSavingName, setIsSavingName] = useState(false);
  const [isSavingVisibility, setIsSavingVisibility] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [docCount, setDocCount] = useState<number | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleRename = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === folder.name || !app) return;
    setIsSavingName(true);
    setError(null);
    try {
      const manager = new FolderContextManager(app);
      await manager.renameFolderContext(generalContextId, folder.context_id, trimmed);
      onRenamed(folder.context_id, trimmed);
    } catch (err) {
      console.error('[FolderSettingsPanel] rename failed:', err);
      setError('Failed to rename folder.');
    } finally {
      setIsSavingName(false);
    }
  };

  const handleVisibilityChange = async (mode: 'open' | 'restricted') => {
    if (!app) return;
    setVisibility(mode);
    setIsSavingVisibility(true);
    setError(null);
    try {
      const manager = new FolderContextManager(app);
      await manager.setFolderVisibility(groupId, folder.context_id, mode);
    } catch (err) {
      console.error('[FolderSettingsPanel] visibility change failed:', err);
      setError('Failed to update visibility.');
      setVisibility(mode === 'open' ? 'restricted' : 'open');
    } finally {
      setIsSavingVisibility(false);
    }
  };

  const handleDeleteClick = async () => {
    if (!app) return;
    setError(null);
    try {
      const manager = new FolderContextManager(app);
      const count = await manager.getFolderDocumentCount(folder.context_id);
      setDocCount(count);
      setShowDeleteConfirm(true);
    } catch (err) {
      console.error('[FolderSettingsPanel] doc count fetch failed:', err);
      setDocCount(0);
      setShowDeleteConfirm(true);
    }
  };

  const handleConfirmDelete = async () => {
    if (!app) return;
    if (docCount !== null && docCount > 0 && deleteConfirm !== 'delete') return;
    setIsDeleting(true);
    setError(null);
    try {
      const manager = new FolderContextManager(app);
      await manager.deleteFolderContext(groupId, generalContextId, folder.context_id);
      onDeleted(folder.context_id);
      onClose();
    } catch (err) {
      console.error('[FolderSettingsPanel] delete failed:', err);
      setError('Failed to delete folder.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-card border border-border rounded-xl shadow-lg w-full max-w-sm p-6 relative">
        <button
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </button>

        <h2 className="text-base font-semibold mb-4">Folder Settings</h2>

        {error && (
          <p className="text-xs text-destructive mb-3">{error}</p>
        )}

        {/* Rename */}
        <div className="mb-4">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Name</label>
          <div className="flex gap-2">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRename()}
              className="flex-1 px-3 py-1.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30"
              disabled={isSavingName}
            />
            <Button
              size="sm"
              onClick={handleRename}
              disabled={!name.trim() || name.trim() === folder.name || isSavingName}
            >
              {isSavingName ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save'}
            </Button>
          </div>
        </div>

        {/* Visibility */}
        <div className="mb-6">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Visibility
            {isSavingVisibility && <Loader2 className="w-3 h-3 animate-spin inline ml-1.5" />}
          </label>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                value="open"
                checked={visibility === 'open'}
                onChange={() => handleVisibilityChange('open')}
                className="accent-primary"
                disabled={isSavingVisibility}
              />
              Open
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                value="restricted"
                checked={visibility === 'restricted'}
                onChange={() => handleVisibilityChange('restricted')}
                className="accent-primary"
                disabled={isSavingVisibility}
              />
              Restricted
            </label>
          </div>
        </div>

        {/* Delete */}
        {!showDeleteConfirm ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={handleDeleteClick}
          >
            <Trash2 className="w-3.5 h-3.5 mr-1.5" />
            Delete Folder
          </Button>
        ) : (
          <div className="border border-destructive/30 rounded-lg p-3 space-y-3">
            <p className="text-sm text-destructive font-medium">Delete this folder?</p>
            {docCount !== null && docCount > 0 ? (
              <>
                <p className="text-xs text-muted-foreground">
                  This folder contains <strong>{docCount}</strong> document{docCount !== 1 ? 's' : ''}.
                  Type <strong>delete</strong> to confirm.
                </p>
                <input
                  type="text"
                  value={deleteConfirm}
                  onChange={(e) => setDeleteConfirm(e.target.value)}
                  placeholder="Type &quot;delete&quot; to confirm"
                  className="w-full px-3 py-1.5 text-sm bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-destructive/30"
                />
              </>
            ) : (
              <p className="text-xs text-muted-foreground">This folder is empty.</p>
            )}
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteConfirm('');
                }}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleConfirmDelete}
                disabled={
                  isDeleting ||
                  (docCount !== null && docCount > 0 && deleteConfirm !== 'delete')
                }
              >
                {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                Delete
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
