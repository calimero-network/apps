import React, { useEffect, useState, useCallback } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import { FolderContextManager } from '@/api/FolderContextManager';
import { WorkspaceManager, type MemberInfo } from '@/api/WorkspaceManager';
import { FolderRegistryEntry } from '@/api/AbiClient';
import { useWorkspace } from '@/context/WorkspaceContext';
import { Button } from '@/components/ui/button';
import { X, Loader2, Trash2, UserPlus, UserMinus, Users } from 'lucide-react';

interface FolderSettingsPanelProps {
  folder: FolderRegistryEntry;
  groupId: string;
  generalContextId: string;
  isOpen: boolean;
  /** When false, name editing and folder deletion UI are hidden (e.g. lacking create-context capability). */
  allowRenameDelete?: boolean;
  onClose: () => void;
  onRenamed: (contextId: string, newName: string) => void;
  onDeleted: (contextId: string) => void;
  onVisibilityChanged?: (contextId: string, mode: 'open' | 'restricted') => void;
}

export const FolderSettingsPanel: React.FC<FolderSettingsPanelProps> = ({
  folder,
  groupId,
  generalContextId,
  isOpen,
  allowRenameDelete = true,
  onClose,
  onRenamed,
  onDeleted,
  onVisibilityChanged,
}) => {
  const { app } = useCalimero();
  const { activeGroupId } = useWorkspace();

  const [name, setName] = useState(folder.name);
  const [visibility, setVisibility] = useState<'open' | 'restricted'>('open');
  const [isSavingName, setIsSavingName] = useState(false);
  const [isSavingVisibility, setIsSavingVisibility] = useState(false);
  const [isLoadingVisibility, setIsLoadingVisibility] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [docCount, setDocCount] = useState<number | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Allowlist state
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [allMembers, setAllMembers] = useState<MemberInfo[]>([]);
  const [isLoadingAllowlist, setIsLoadingAllowlist] = useState(false);
  const [isSavingAllowlist, setIsSavingAllowlist] = useState(false);

  useEffect(() => {
    setName(folder.name);
  }, [folder.context_id, folder.name]);

  useEffect(() => {
    if (!isOpen || !app) return;

    let cancelled = false;
    setIsLoadingVisibility(true);
    setError(null);

    const manager = new FolderContextManager(app);
    manager.getFolderVisibility(groupId, folder.context_id)
      .then((mode) => {
        if (!cancelled) {
          setVisibility(mode);
        }
      })
      .catch((err) => {
        console.error('[FolderSettingsPanel] visibility fetch failed:', err);
        if (!cancelled) {
          setError('Failed to load current folder visibility.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingVisibility(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [app, folder.context_id, groupId, isOpen]);

  const loadAllowlist = useCallback(async () => {
    if (!app || !activeGroupId || visibility !== 'restricted') return;
    setIsLoadingAllowlist(true);
    try {
      const fcm = new FolderContextManager(app);
      const wm = new WorkspaceManager(app);
      const [list, memberResult] = await Promise.all([
        fcm.getContextAllowlist(activeGroupId, folder.context_id),
        wm.getWorkspaceMembers(activeGroupId),
      ]);
      setAllowlist(list);
      setAllMembers(memberResult.members);
    } catch {
      // Non-blocking
    } finally {
      setIsLoadingAllowlist(false);
    }
  }, [app, activeGroupId, folder.context_id, visibility]);

  useEffect(() => {
    if (isOpen && visibility === 'restricted') {
      void loadAllowlist();
    }
  }, [isOpen, visibility, loadAllowlist]);

  const handleAddToAllowlist = async (identity: string) => {
    if (!app || !activeGroupId) return;
    setIsSavingAllowlist(true);
    try {
      const fcm = new FolderContextManager(app);
      await fcm.addToContextAllowlist(activeGroupId, folder.context_id, identity);
      setAllowlist((prev) => [...prev, identity]);
    } catch {
      setError('Failed to add member to allowlist.');
    } finally {
      setIsSavingAllowlist(false);
    }
  };

  const handleRemoveFromAllowlist = async (identity: string) => {
    if (!app || !activeGroupId) return;
    setIsSavingAllowlist(true);
    try {
      const fcm = new FolderContextManager(app);
      await fcm.removeFromContextAllowlist(activeGroupId, folder.context_id, identity);
      setAllowlist((prev) => prev.filter((id) => id !== identity));
    } catch {
      setError('Failed to remove member from allowlist.');
    } finally {
      setIsSavingAllowlist(false);
    }
  };

  const formatId = (id: string) => {
    if (id.length <= 16) return id;
    return `${id.slice(0, 8)}...${id.slice(-6)}`;
  };

  const getMemberLabel = (identity: string) => {
    const member = allMembers.find((m) => m.identity === identity);
    return member?.alias?.trim() || formatId(identity);
  };

  const normalizeId = (a: string) => a.trim().toLowerCase();
  const nonAllowlistedMembers = allMembers.filter(
    (m) => !allowlist.some((id) => normalizeId(id) === normalizeId(m.identity)),
  );

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
    const previous = visibility;
    setVisibility(mode);
    setIsSavingVisibility(true);
    setError(null);
    try {
      const manager = new FolderContextManager(app);
      await manager.setFolderVisibility(groupId, folder.context_id, mode);
      onVisibilityChanged?.(folder.context_id, mode);
    } catch (err) {
      console.error('[FolderSettingsPanel] visibility change failed:', err);
      setError('Failed to update visibility.');
      setVisibility(previous);
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
        {allowRenameDelete && (
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
        )}

        {/* Visibility */}
        <div className="mb-6">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Visibility
            {(isSavingVisibility || isLoadingVisibility) && (
              <Loader2 className="w-3 h-3 animate-spin inline ml-1.5" />
            )}
          </label>
          <div className="flex gap-3">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                value="open"
                checked={visibility === 'open'}
                onChange={() => handleVisibilityChange('open')}
                className="accent-primary"
                disabled={isSavingVisibility || isLoadingVisibility}
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
                disabled={isSavingVisibility || isLoadingVisibility}
              />
              Restricted
            </label>
          </div>
        </div>

        {/* Allowlist (restricted only) */}
        {visibility === 'restricted' && (
          <div className="mb-6">
            <label className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Users className="w-3 h-3" />
              Allowed Members
              {(isLoadingAllowlist || isSavingAllowlist) && (
                <Loader2 className="w-3 h-3 animate-spin" />
              )}
            </label>

            {allowlist.length === 0 && !isLoadingAllowlist && (
              <p className="text-xs text-muted-foreground mb-2">No members allowlisted yet.</p>
            )}

            {allowlist.length > 0 && (
              <div className="space-y-1 mb-2 max-h-32 overflow-y-auto">
                {allowlist.map((identity) => (
                  <div
                    key={identity}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg bg-muted/50 text-sm"
                  >
                    <span className="truncate" title={identity}>
                      {getMemberLabel(identity)}
                    </span>
                    <button
                      className="flex-shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                      onClick={() => handleRemoveFromAllowlist(identity)}
                      disabled={isSavingAllowlist}
                      title="Remove from allowlist"
                    >
                      <UserMinus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {nonAllowlistedMembers.length > 0 && (
              <div className="border border-border rounded-lg">
                <p className="text-xs text-muted-foreground px-2 py-1.5 border-b border-border">
                  Add member
                </p>
                <div className="max-h-32 overflow-y-auto">
                  {nonAllowlistedMembers.map((member) => (
                    <button
                      key={member.identity}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 w-full text-left text-sm hover:bg-muted/50 transition-colors"
                      onClick={() => handleAddToAllowlist(member.identity)}
                      disabled={isSavingAllowlist}
                    >
                      <span className="truncate" title={member.identity}>
                        {member.alias?.trim() || formatId(member.identity)}
                      </span>
                      <UserPlus className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Delete */}
        {allowRenameDelete && (
          !showDeleteConfirm ? (
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
          )
        )}
      </div>
    </div>
  );
};
