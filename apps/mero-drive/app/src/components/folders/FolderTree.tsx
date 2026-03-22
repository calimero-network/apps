import React, { useState, useCallback } from 'react';
import { useCalimero } from '@calimero-network/calimero-client';
import {
  FolderTreeItem,
} from '@/api/AbiClient';
import { FolderContextManager, type FolderContextWithVisibility } from '@/api/FolderContextManager';
import type { FolderAccessInfo } from '@/utils/folderAccess';
import { useWorkspace } from '@/context/WorkspaceContext';

type TreeItem = { id: string; folder_id: string | null; name: string };
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  FileText,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  FolderPlus,
  Home,
  Lock,
  Globe,
  Eye,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface FolderTreeProps {
  folders: FolderTreeItem[];
  documents: TreeItem[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (folderId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onOpenDocument: (docId: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (folderId: string) => void;
  // Top-level context-level folders (enriched with visibility + access state)
  topLevelFolders: FolderAccessInfo[];
  activeContextId: string | null;
  generalContextId: string | null;
  onTopLevelFolderSelect: (contextId: string) => void;
  onCreateTopLevelFolder: () => void;
  onTopLevelFolderSettings: (folder: FolderContextWithVisibility) => void;
  onTopLevelFolderVisibilityChanged?: (contextId: string, mode: 'open' | 'restricted') => void;
  canCreateContext: boolean;
}

// Color options for folders
const FOLDER_COLORS: Record<string, string> = {
  default: 'text-amber-500',
  blue: 'text-blue-500',
  green: 'text-green-500',
  red: 'text-red-500',
  purple: 'text-purple-500',
  pink: 'text-pink-500',
  orange: 'text-orange-500',
  teal: 'text-teal-500',
};

const FolderTreeNode: React.FC<{
  folder: FolderTreeItem;
  documents: TreeItem[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (folderId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onOpenDocument: (docId: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (folderId: string) => void;
  depth: number;
  canCreateContext: boolean;
}> = ({
  folder,
  documents,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onOpenDocument,
  expandedFolders,
  onToggleFolder,
  depth,
  canCreateContext,
}) => {
  const isExpanded = expandedFolders.has(folder.id);
  const isSelected = selectedFolderId === folder.id;
  const hasChildren = folder.children.length > 0 || folder.document_count > 0;
  const colorClass = folder.color ? FOLDER_COLORS[folder.color] || FOLDER_COLORS.default : FOLDER_COLORS.default;

  // Get documents in this folder
  const folderDocs = documents.filter(d => d.folder_id === folder.id);

  return (
    <div>
      <div
        className={`group flex items-center gap-1 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
          isSelected
            ? 'bg-primary/10 text-primary'
            : 'hover:bg-muted'
        }`}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => onSelectFolder(folder.id)}
      >
        {/* Expand/Collapse Toggle */}
        <button
          className="w-4 h-4 flex items-center justify-center flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onToggleFolder(folder.id);
          }}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
            )
          ) : (
            <span className="w-3.5" />
          )}
        </button>

        {/* Folder Icon */}
        {isExpanded ? (
          <FolderOpen className={`w-4 h-4 flex-shrink-0 ${colorClass}`} />
        ) : (
          <Folder className={`w-4 h-4 flex-shrink-0 ${colorClass}`} />
        )}

        {/* Folder Name */}
        <span className="text-sm truncate flex-1">{folder.name}</span>

        {/* Document Count Badge */}
        {folder.document_count > 0 && (
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {folder.document_count}
          </span>
        )}

        {/* Actions Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={(e) => {
              e.stopPropagation();
              onCreateFolder(folder.id);
            }}>
              <FolderPlus className="w-4 h-4 mr-2" />
              New Subfolder
            </DropdownMenuItem>
            {canCreateContext && (
              <>
                <DropdownMenuItem onClick={(e) => {
                  e.stopPropagation();
                  onRenameFolder(folder.id);
                }}>
                  <Pencil className="w-4 h-4 mr-2" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteFolder(folder.id);
                  }}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Expanded Content */}
      {isExpanded && (
        <div>
          {/* Subfolders */}
          {folder.children.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={child}
              documents={documents}
              selectedFolderId={selectedFolderId}
              onSelectFolder={onSelectFolder}
              onCreateFolder={onCreateFolder}
              onRenameFolder={onRenameFolder}
              onDeleteFolder={onDeleteFolder}
              onOpenDocument={onOpenDocument}
              expandedFolders={expandedFolders}
              onToggleFolder={onToggleFolder}
              depth={depth + 1}
              canCreateContext={canCreateContext}
            />
          ))}

          {/* Documents in this folder */}
          {folderDocs.map((doc) => (
            <div
              key={doc.id}
              className="group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-muted transition-colors"
              style={{ paddingLeft: `${(depth + 1) * 12 + 8 + 16}px` }}
              onClick={() => onOpenDocument(doc.id)}
            >
              <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm truncate">{doc.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Top-level context folder entry ──────────────────────────────────────────

interface TopLevelFolderEntryProps {
  folder: FolderAccessInfo;
  isActive: boolean;
  onSelect: (contextId: string) => void;
  onSettings: (folder: FolderContextWithVisibility) => void;
  onCreateRootFolder: () => void;
  onVisibilityChanged?: (contextId: string, mode: 'open' | 'restricted') => void;
  canCreateContext: boolean;
}

const TopLevelFolderEntry: React.FC<TopLevelFolderEntryProps> = ({
  folder,
  isActive,
  onSelect,
  onSettings,
  onCreateRootFolder,
  onVisibilityChanged,
  canCreateContext,
}) => {
  const { app } = useCalimero();
  const { activeGroupId } = useWorkspace();

  const [isSavingVisibility, setIsSavingVisibility] = useState(false);

  const colorClass = folder.color
    ? FOLDER_COLORS[folder.color] || FOLDER_COLORS.default
    : FOLDER_COLORS.default;

  const isRestricted = folder.visibility === 'restricted';
  const { canJoin } = folder;
  const showNewSubfolder = isActive && canJoin;
  const showRenameDelete = canCreateContext;
  const showMenuSeparatorBeforeVisibility = showNewSubfolder || showRenameDelete;

  const handleVisibilityToggle = useCallback(async (mode: 'open' | 'restricted') => {
    if (!app || !activeGroupId || mode === folder.visibility) return;
    setIsSavingVisibility(true);
    try {
      const manager = new FolderContextManager(app);
      await manager.setFolderVisibility(activeGroupId, folder.context_id, mode);
      onVisibilityChanged?.(folder.context_id, mode);
    } catch (err) {
      console.error('[TopLevelFolderEntry] visibility change failed:', err);
    } finally {
      setIsSavingVisibility(false);
    }
  }, [app, activeGroupId, folder.context_id, folder.visibility, onVisibilityChanged]);

  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
        canJoin ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
      } ${isActive ? 'bg-primary/10 text-primary' : canJoin ? 'hover:bg-muted' : ''}`}
      onClick={() => canJoin && onSelect(folder.context_id)}
      title={canJoin ? undefined : isRestricted ? 'Restricted — you are not on the allowlist' : 'You lack permission to join open folders'}
    >
      {isRestricted ? (
        <Lock className={`w-4 h-4 flex-shrink-0 ${canJoin ? 'text-amber-500' : 'text-muted-foreground'}`} />
      ) : (
        <Folder className={`w-4 h-4 flex-shrink-0 ${colorClass}`} />
      )}

      <span className="text-sm truncate flex-1">
        {folder.name || 'Untitled Folder'}
      </span>

      <DropdownMenu>
        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
          >
            <MoreHorizontal className="w-3.5 h-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {showNewSubfolder && (
            <DropdownMenuItem onClick={(e) => {
              e.stopPropagation();
              onCreateRootFolder();
            }}>
              <FolderPlus className="w-4 h-4 mr-2" />
              New Subfolder
            </DropdownMenuItem>
          )}
          {showRenameDelete && (
            <DropdownMenuItem onClick={(e) => {
              e.stopPropagation();
              onSettings(folder);
            }}>
              <Pencil className="w-4 h-4 mr-2" />
              Rename / Delete
            </DropdownMenuItem>
          )}
          {showMenuSeparatorBeforeVisibility && <DropdownMenuSeparator />}
          <div className="px-2 py-1.5">
            <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
              <Eye className="w-3 h-3" />
              Visibility
              {isSavingVisibility && <Loader2 className="w-3 h-3 animate-spin" />}
            </p>
            <div className="flex gap-1">
              <button
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors flex-1 justify-center ${
                  !isRestricted
                    ? 'bg-primary/15 text-primary font-medium'
                    : 'hover:bg-muted text-muted-foreground'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleVisibilityToggle('open');
                }}
                disabled={isSavingVisibility}
              >
                <Globe className="w-3 h-3" />
                Open
              </button>
              <button
                className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors flex-1 justify-center ${
                  isRestricted
                    ? 'bg-amber-500/15 text-amber-500 font-medium'
                    : 'hover:bg-muted text-muted-foreground'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleVisibilityToggle('restricted');
                }}
                disabled={isSavingVisibility}
              >
                <Lock className="w-3 h-3" />
                Restricted
              </button>
            </div>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

// ─── Main FolderTree export ───────────────────────────────────────────────────

export const FolderTree: React.FC<FolderTreeProps> = ({
  folders,
  documents,
  selectedFolderId,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onOpenDocument,
  expandedFolders,
  onToggleFolder,
  topLevelFolders,
  activeContextId,
  generalContextId,
  onTopLevelFolderSelect,
  onCreateTopLevelFolder,
  onTopLevelFolderSettings,
  onTopLevelFolderVisibilityChanged,
  canCreateContext,
}) => {
  const isGeneralContext = activeContextId === generalContextId;
  const hasAnyFolderContexts = Boolean(generalContextId) || topLevelFolders.length > 0;

  const renderContextSubfolders = () => {
    if (!activeContextId) return null;
    if (folders.length === 0) {
      return (
        <div className="pl-9 pr-2 py-1 text-xs text-muted-foreground">
          No subfolders yet
        </div>
      );
    }
    return (
      <>
        {folders.map((folder) => (
          <FolderTreeNode
            key={folder.id}
            folder={folder}
            documents={documents}
            selectedFolderId={selectedFolderId}
            onSelectFolder={onSelectFolder}
            onCreateFolder={onCreateFolder}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            onOpenDocument={onOpenDocument}
            expandedFolders={expandedFolders}
            onToggleFolder={onToggleFolder}
            depth={1}
            canCreateContext={canCreateContext}
          />
        ))}
      </>
    );
  };

  return (
    <div className="flex flex-col gap-0.5">
      {/* ── Folder contexts (General + top-level folder contexts) ── */}
      <div className="mb-1">
        <div className="flex items-center justify-between px-2 mb-1">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Folders
          </span>
          {canCreateContext && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs gap-1"
              onClick={onCreateTopLevelFolder}
              title="New Folder"
            >
              <Plus className="w-3.5 h-3.5" />
              New
            </Button>
          )}
        </div>

        {generalContextId && (
          <>
            <div
              className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors cursor-pointer ${
                isGeneralContext ? 'bg-primary/10 text-primary' : 'hover:bg-muted'
              }`}
              onClick={() => onTopLevelFolderSelect(generalContextId)}
            >
              <Home className="w-4 h-4 flex-shrink-0 text-teal-600" />
              <span className="text-sm truncate flex-1">General</span>
              {isGeneralContext && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateFolder(null);
                  }}
                  title="New Subfolder"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
            {isGeneralContext && renderContextSubfolders()}
          </>
        )}

        {topLevelFolders.map((folder) => {
          const isActive = activeContextId === folder.context_id;
          return (
            <React.Fragment key={folder.context_id}>
              <TopLevelFolderEntry
                folder={folder}
                isActive={isActive}
                onSelect={onTopLevelFolderSelect}
                onSettings={onTopLevelFolderSettings}
                onCreateRootFolder={() => onCreateFolder(null)}
                onVisibilityChanged={onTopLevelFolderVisibilityChanged}
                canCreateContext={canCreateContext}
              />
              {isActive && renderContextSubfolders()}
            </React.Fragment>
          );
        })}

        {!hasAnyFolderContexts && (
          <div className="px-2 py-1.5 text-xs text-muted-foreground">
            No folders available
          </div>
        )}
      </div>

    </div>
  );
};

export default FolderTree;
