import React from 'react';
import {
  FolderTreeItem,
  DocumentSummary,
  FolderRegistryEntry,
} from '@/api/AbiClient';
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
  Settings,
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
  documents: DocumentSummary[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (folderId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onOpenDocument: (docId: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (folderId: string) => void;
  // Top-level context-level folders
  topLevelFolders: FolderRegistryEntry[];
  activeContextId: string | null;
  generalContextId: string | null;
  onTopLevelFolderSelect: (contextId: string) => void;
  onCreateTopLevelFolder: () => void;
  onTopLevelFolderSettings: (folder: FolderRegistryEntry) => void;
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
  documents: DocumentSummary[];
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onCreateFolder: (parentId: string | null) => void;
  onRenameFolder: (folderId: string) => void;
  onDeleteFolder: (folderId: string) => void;
  onOpenDocument: (docId: string) => void;
  expandedFolders: Set<string>;
  onToggleFolder: (folderId: string) => void;
  depth: number;
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
              <span className="text-sm truncate">{doc.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Top-level context folder entry ──────────────────────────────────────────

interface TopLevelFolderEntryProps {
  folder: FolderRegistryEntry;
  isActive: boolean;
  isRestricted?: boolean;
  isMember?: boolean;
  onSelect: (contextId: string) => void;
  onSettings: (folder: FolderRegistryEntry) => void;
}

const TopLevelFolderEntry: React.FC<TopLevelFolderEntryProps> = ({
  folder,
  isActive,
  isRestricted = false,
  isMember = true,
  onSelect,
  onSettings,
}) => {
  const colorClass = folder.color
    ? FOLDER_COLORS[folder.color] || FOLDER_COLORS.default
    : FOLDER_COLORS.default;

  const canEnter = !isRestricted || isMember;

  return (
    <div
      className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors ${
        canEnter ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
      } ${isActive ? 'bg-primary/10 text-primary' : canEnter ? 'hover:bg-muted' : ''}`}
      onClick={() => canEnter && onSelect(folder.context_id)}
    >
      {isRestricted ? (
        <Lock className="w-4 h-4 flex-shrink-0 text-muted-foreground" />
      ) : (
        <Folder className={`w-4 h-4 flex-shrink-0 ${colorClass}`} />
      )}

      <span className="text-sm truncate flex-1">
        {folder.name || 'Untitled Folder'}
      </span>

      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onSettings(folder);
        }}
        title="Folder Settings"
      >
        <Settings className="w-3.5 h-3.5" />
      </Button>
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
  canCreateContext,
}) => {
  // Get documents at root level (no folder)
  const rootDocs = documents.filter(d => d.folder_id === null);
  const isRootSelected = selectedFolderId === null;
  const isGeneralContext = activeContextId === generalContextId;

  return (
    <div className="flex flex-col gap-0.5">
      {/* ── Tier 1: Top-level context folders ── */}
      {topLevelFolders.length > 0 && (
        <div className="mb-2">
          <div className="flex items-center justify-between px-2 mb-1">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Workspaces
            </span>
            {canCreateContext && (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5"
                onClick={onCreateTopLevelFolder}
                title="New Top-level Folder"
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
          {topLevelFolders.map((folder) => (
            <TopLevelFolderEntry
              key={folder.context_id}
              folder={folder}
              isActive={activeContextId === folder.context_id}
              onSelect={onTopLevelFolderSelect}
              onSettings={onTopLevelFolderSettings}
            />
          ))}
          {canCreateContext && topLevelFolders.length === 0 && (
            <button
              className="w-full text-left px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={onCreateTopLevelFolder}
            >
              + New Folder
            </button>
          )}
        </div>
      )}

      {/* ── Tier 2: Subfolders within active context ── */}
      {/* Root / All Documents — only shown when in general context or no top-level folders */}
      <div
        className={`group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
          isRootSelected
            ? 'bg-primary/10 text-primary'
            : 'hover:bg-muted'
        }`}
        onClick={() => onSelectFolder(null)}
      >
        <Home className="w-4 h-4" />
        <span className="text-sm font-medium flex-1">
          {isGeneralContext ? 'General' : 'All Documents'}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            onCreateFolder(null);
          }}
        >
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Folder Tree */}
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
          depth={0}
        />
      ))}

      {/* Root Documents (only shown when root is selected) */}
      {isRootSelected && rootDocs.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <div className="px-2 py-1 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Root Documents
          </div>
          {rootDocs.map((doc) => (
            <div
              key={doc.id}
              className="group flex items-center gap-2 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-muted transition-colors ml-4"
              onClick={() => onOpenDocument(doc.id)}
            >
              <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm truncate">{doc.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FolderTree;
