import React, { useState, useCallback, useEffect } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import {
  FolderContextManager,
  type FolderContextWithVisibility,
} from '@/api/FolderContextManager';
import { WorkspaceManager, type MemberInfo } from '@/api/WorkspaceManager';
import { useWorkspace } from '@/context/WorkspaceContext';
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  Globe,
  Lock,
  UserPlus,
  UserMinus,
  AlertCircle,
} from 'lucide-react';

interface FolderRowState {
  allowlist: string[];
  isLoadingAllowlist: boolean;
  isSavingVisibility: boolean;
  isSavingAllowlist: boolean;
  error: string | null;
}

export const AdminFoldersSection: React.FC = () => {
  const { app } = useCalimero();
  const { activeGroupId, generalContextId } = useWorkspace();

  const [folders, setFolders] = useState<FolderContextWithVisibility[]>([]);
  const [allMembers, setAllMembers] = useState<MemberInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [expandedFolder, setExpandedFolder] = useState<string | null>(null);
  const [rowStates, setRowStates] = useState<Record<string, FolderRowState>>({});

  const loadFolders = useCallback(async () => {
    if (!app || !activeGroupId) return;
    setIsLoading(true);
    try {
      const fcm = new FolderContextManager(app);
      const wm = new WorkspaceManager(app);
      const [folderList, memberResult] = await Promise.all([
        fcm.listGroupFolderContextsWithVisibility(activeGroupId, generalContextId ?? undefined),
        wm.getWorkspaceMembers(activeGroupId),
      ]);
      setFolders(folderList);
      setAllMembers(memberResult.members);
    } catch {
      // Non-blocking
    } finally {
      setIsLoading(false);
    }
  }, [app, activeGroupId, generalContextId]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  const loadAllowlist = useCallback(async (contextId: string) => {
    if (!app || !activeGroupId) return;
    setRowStates((prev) => ({
      ...prev,
      [contextId]: {
        ...prev[contextId],
        isLoadingAllowlist: true,
        error: null,
        allowlist: [],
        isSavingVisibility: false,
        isSavingAllowlist: false,
      },
    }));

    try {
      const fcm = new FolderContextManager(app);
      const list = await fcm.getContextAllowlist(activeGroupId, contextId);
      setRowStates((prev) => ({
        ...prev,
        [contextId]: { ...prev[contextId], allowlist: list, isLoadingAllowlist: false },
      }));
    } catch {
      setRowStates((prev) => ({
        ...prev,
        [contextId]: { ...prev[contextId], isLoadingAllowlist: false, allowlist: [] },
      }));
    }
  }, [app, activeGroupId]);

  const handleExpandFolder = (contextId: string) => {
    if (expandedFolder === contextId) {
      setExpandedFolder(null);
      return;
    }
    setExpandedFolder(contextId);
    void loadAllowlist(contextId);
  };

  const handleVisibilityChange = async (contextId: string, mode: 'open' | 'restricted') => {
    if (!app || !activeGroupId) return;

    setRowStates((prev) => ({
      ...prev,
      [contextId]: { ...prev[contextId], isSavingVisibility: true, error: null },
    }));

    try {
      const fcm = new FolderContextManager(app);
      await fcm.setFolderVisibility(activeGroupId, contextId, mode);
      setFolders((prev) =>
        prev.map((f) => (f.context_id === contextId ? { ...f, visibility: mode } : f)),
      );
      if (mode === 'restricted') {
        void loadAllowlist(contextId);
      }
    } catch {
      setRowStates((prev) => ({
        ...prev,
        [contextId]: { ...prev[contextId], error: 'Failed to update visibility.' },
      }));
    } finally {
      setRowStates((prev) => ({
        ...prev,
        [contextId]: { ...prev[contextId], isSavingVisibility: false },
      }));
    }
  };

  const handleAddToAllowlist = async (contextId: string, identity: string) => {
    if (!app || !activeGroupId) return;
    setRowStates((prev) => ({
      ...prev,
      [contextId]: { ...prev[contextId], isSavingAllowlist: true, error: null },
    }));

    try {
      const fcm = new FolderContextManager(app);
      await fcm.addToContextAllowlist(activeGroupId, contextId, identity);
      setRowStates((prev) => ({
        ...prev,
        [contextId]: {
          ...prev[contextId],
          allowlist: [...prev[contextId].allowlist, identity],
          isSavingAllowlist: false,
        },
      }));
    } catch {
      setRowStates((prev) => ({
        ...prev,
        [contextId]: { ...prev[contextId], isSavingAllowlist: false, error: 'Failed to add member.' },
      }));
    }
  };

  const handleRemoveFromAllowlist = async (contextId: string, identity: string) => {
    if (!app || !activeGroupId) return;
    setRowStates((prev) => ({
      ...prev,
      [contextId]: { ...prev[contextId], isSavingAllowlist: true, error: null },
    }));

    try {
      const fcm = new FolderContextManager(app);
      await fcm.removeFromContextAllowlist(activeGroupId, contextId, identity);
      setRowStates((prev) => ({
        ...prev,
        [contextId]: {
          ...prev[contextId],
          allowlist: prev[contextId].allowlist.filter((id) => id !== identity),
          isSavingAllowlist: false,
        },
      }));
    } catch {
      setRowStates((prev) => ({
        ...prev,
        [contextId]: { ...prev[contextId], isSavingAllowlist: false, error: 'Failed to remove member.' },
      }));
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

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading folders...
      </div>
    );
  }

  if (folders.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        No folders in this workspace yet.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground mb-3">
        {folders.length} {folders.length === 1 ? 'folder' : 'folders'} in this workspace. Expand to manage visibility and allowlists.
      </p>
      {folders.map((folder) => {
        const isExpanded = expandedFolder === folder.context_id;
        const state = rowStates[folder.context_id];
        const allowlist = state?.allowlist ?? [];
        const nonAllowlisted = allMembers.filter(
          (m) => !allowlist.some((id) => normalizeId(id) === normalizeId(m.identity)),
        );

        return (
          <div key={folder.context_id} className="border border-border rounded-lg overflow-hidden">
            {/* Row header */}
            <button
              type="button"
              className="flex items-center gap-3 px-4 py-3 w-full text-left hover:bg-muted/30 transition-colors"
              onClick={() => handleExpandFolder(folder.context_id)}
            >
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium">{folder.name}</span>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {folder.visibility === 'open' ? (
                  <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500">
                    <Globe className="w-3 h-3" />
                    Open
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-500">
                    <Lock className="w-3 h-3" />
                    Restricted
                  </span>
                )}
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="px-4 pb-4 pt-1 border-t border-border bg-muted/10 space-y-4">
                {/* Visibility toggle */}
                <div className="pt-2">
                  <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
                    Visibility
                    {state?.isSavingVisibility && (
                      <Loader2 className="w-3 h-3 animate-spin inline ml-1.5" />
                    )}
                  </h4>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        value="open"
                        checked={folder.visibility === 'open'}
                        onChange={() => handleVisibilityChange(folder.context_id, 'open')}
                        className="accent-primary"
                        disabled={state?.isSavingVisibility}
                      />
                      Open
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        value="restricted"
                        checked={folder.visibility === 'restricted'}
                        onChange={() => handleVisibilityChange(folder.context_id, 'restricted')}
                        className="accent-primary"
                        disabled={state?.isSavingVisibility}
                      />
                      Restricted
                    </label>
                  </div>
                </div>

                {/* Allowlist (restricted only) */}
                {folder.visibility === 'restricted' && (
                  <div>
                    <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      Allowed Members
                      {(state?.isLoadingAllowlist || state?.isSavingAllowlist) && (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      )}
                    </h4>

                    {allowlist.length === 0 && !state?.isLoadingAllowlist && (
                      <p className="text-xs text-muted-foreground mb-2">
                        No members allowlisted yet. Only admins can access.
                      </p>
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
                              onClick={() => handleRemoveFromAllowlist(folder.context_id, identity)}
                              disabled={state?.isSavingAllowlist}
                              title="Remove from allowlist"
                            >
                              <UserMinus className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {nonAllowlisted.length > 0 && (
                      <div className="border border-border rounded-lg">
                        <p className="text-xs text-muted-foreground px-2 py-1.5 border-b border-border">
                          Add member
                        </p>
                        <div className="max-h-32 overflow-y-auto">
                          {nonAllowlisted.map((member) => (
                            <button
                              key={member.identity}
                              className="flex items-center justify-between gap-2 px-2 py-1.5 w-full text-left text-sm hover:bg-muted/50 transition-colors"
                              onClick={() => handleAddToAllowlist(folder.context_id, member.identity)}
                              disabled={state?.isSavingAllowlist}
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

                {/* Error */}
                {state?.error && (
                  <div className="flex items-center gap-2 text-xs text-destructive">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {state.error}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default AdminFoldersSection;
