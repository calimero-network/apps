import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCalimero } from '@calimero-network/calimero-client';
import { AbiClient, DocumentSummary, FolderTreeItem, FolderResponse, FolderRegistryEntry } from '@/api/AbiClient';
import { FolderContextManager } from '@/api/FolderContextManager';
import { useWorkspace } from '@/context/WorkspaceContext';
import { LogoWithText } from '@/components/icons/Logo';
import { Button } from '@/components/ui/button';
import { FolderTree } from '@/components/folders/FolderTree';
import { FolderDialog } from '@/components/folders/FolderDialog';
import { FolderSettingsPanel } from '@/components/folders/FolderSettingsPanel';
import { ShareDialog } from '@/components/sharing/ShareDialog';
import { MembersIndicator } from '@/components/sharing/MembersIndicator';
import { WorkspaceSwitcher } from '@/components/workspace/WorkspaceSwitcher';
import {
  Plus,
  Search,
  FileText,
  Clock,
  Tag,
  Archive,
  Trash2,
  MoreHorizontal,
  LogOut,
  Shield,
  WifiOff,
  LayoutGrid,
  List,
  Calendar,
  Folder,
  FolderPlus,
  FolderInput,
  Share2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';

const HomePage: React.FC = () => {
  const { app, logout, isAuthenticated } = useCalimero();
  const navigate = useNavigate();
  const { activeContextId, generalContextId, activeGroupId, setActiveContext } = useWorkspace();

  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [allDocuments, setAllDocuments] = useState<DocumentSummary[]>([]);
  const [folders, setFolders] = useState<FolderTreeItem[]>([]);
  const [flatFolders, setFlatFolders] = useState<FolderResponse[]>([]);
  const [topLevelFolders, setTopLevelFolders] = useState<FolderRegistryEntry[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<'synced' | 'syncing' | 'offline'>('synced');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    const saved = localStorage.getItem('docs-view-mode');
    return (saved === 'list' || saved === 'grid') ? saved : 'grid';
  });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('docs-expanded-folders');
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  // Folder dialog state
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderDialogMode, setFolderDialogMode] = useState<'create' | 'rename'>('create');
  const [folderDialogParentId, setFolderDialogParentId] = useState<string | null>(null);
  const [folderDialogFolderId, setFolderDialogFolderId] = useState<string | null>(null);
  const [folderDialogInitialName, setFolderDialogInitialName] = useState('');
  const [folderDialogInitialColor, setFolderDialogInitialColor] = useState<string | null>(null);

  // Top-level folder creation
  const [topLevelFolderDialogOpen, setTopLevelFolderDialogOpen] = useState(false);

  // Folder settings panel state
  const [folderSettingsOpen, setFolderSettingsOpen] = useState(false);
  const [folderSettingsTarget, setFolderSettingsTarget] = useState<FolderRegistryEntry | null>(null);

  // Share dialog state
  const [shareDialogOpen, setShareDialogOpen] = useState(false);

  // Persist view mode preference
  useEffect(() => {
    localStorage.setItem('docs-view-mode', viewMode);
  }, [viewMode]);

  // Persist expanded folders
  useEffect(() => {
    localStorage.setItem('docs-expanded-folders', JSON.stringify([...expandedFolders]));
  }, [expandedFolders]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  // Load top-level folders when workspace changes
  useEffect(() => {
    if (!app || !generalContextId) return;
    const manager = new FolderContextManager(app);
    manager.listFolderContexts(generalContextId)
      .then(setTopLevelFolders)
      .catch((err) => console.error('[HomePage] Failed to load top-level folders:', err));
  }, [app, generalContextId]);

  // Load documents and folders — re-runs when active context changes
  const loadData = useCallback(async () => {
    if (!app || !activeContextId) return;

    setIsLoading(true);
    setSyncStatus('syncing');
    try {
      const client = new AbiClient(app, activeContextId);

      // Load folders
      const [folderTree, folderList] = await Promise.all([
        client.getFolderTree(),
        client.listFolders(),
      ]);
      setFolders(folderTree);
      setFlatFolders(folderList);

      // Load documents based on filters
      let docs: DocumentSummary[];
      if (searchQuery) {
        docs = await client.searchDocuments({ query: searchQuery, include_archived: includeArchived });
      } else if (selectedTag) {
        docs = await client.getDocumentsByTag({ tag: selectedTag, include_archived: includeArchived });
      } else if (selectedFolderId !== null) {
        docs = await client.getDocumentsInFolder({ folder_id: selectedFolderId, include_archived: includeArchived });
      } else {
        docs = await client.listDocuments({ include_archived: includeArchived });
      }

      setDocuments(docs);

      // Also load all documents for folder tree display
      const allDocs = await client.listDocuments({ include_archived: includeArchived });
      setAllDocuments(allDocs);

      // Load all tags
      const tags = await client.getAllTags();
      setAllTags(tags);

      setSyncStatus('synced');
    } catch (error) {
      console.error('Failed to load data:', error);
      setSyncStatus('offline');
    } finally {
      setIsLoading(false);
    }
  }, [app, activeContextId, searchQuery, selectedTag, selectedFolderId, includeArchived]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const createNewDocument = () => {
    navigate('/editor', { state: { folderId: selectedFolderId } });
  };

  const openDocument = (id: string) => {
    navigate(`/editor/${id}`);
  };

  const handleArchive = async (id: string, archived: boolean) => {
    if (!app || !activeContextId) return;
    try {
      const client = new AbiClient(app, activeContextId);
      await client.setArchived({ id, archived: !archived });
      loadData();
    } catch (error) {
      console.error('Failed to archive document:', error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!app || !activeContextId) return;
    if (window.confirm('Are you sure you want to delete this document?')) {
      try {
        const client = new AbiClient(app, activeContextId);
        await client.deleteDocument({ id });
        loadData();
      } catch (error) {
        console.error('Failed to delete document:', error);
      }
    }
  };

  const handleMoveDocument = async (docId: string, folderId: string | null) => {
    if (!app || !activeContextId) return;
    try {
      const client = new AbiClient(app, activeContextId);
      await client.moveDocument({ doc_id: docId, folder_id: folderId });
      loadData();
    } catch (error) {
      console.error('Failed to move document:', error);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } catch (e) {
      console.error('Logout error:', e);
    }
    localStorage.clear();
    sessionStorage.clear();
    window.location.replace('/');
  };

  // Subfolder handlers (within active context)
  const handleCreateFolder = (parentId: string | null) => {
    setFolderDialogMode('create');
    setFolderDialogParentId(parentId);
    setFolderDialogFolderId(null);
    setFolderDialogInitialName('');
    setFolderDialogInitialColor(null);
    setFolderDialogOpen(true);
  };

  const handleRenameFolder = async (folderId: string) => {
    if (!app || !activeContextId) return;
    try {
      const client = new AbiClient(app, activeContextId);
      const folder = await client.getFolder({ folder_id: folderId });
      if (folder) {
        setFolderDialogMode('rename');
        setFolderDialogParentId(null);
        setFolderDialogFolderId(folderId);
        setFolderDialogInitialName(folder.name);
        setFolderDialogInitialColor(folder.color);
        setFolderDialogOpen(true);
      }
    } catch (error) {
      console.error('Failed to get folder:', error);
    }
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (!app || !activeContextId) return;
    if (window.confirm('Are you sure you want to delete this folder? Documents will be moved to root.')) {
      try {
        const client = new AbiClient(app, activeContextId);
        await client.deleteFolder({ folder_id: folderId, recursive: true });
        if (selectedFolderId === folderId) {
          setSelectedFolderId(null);
        }
        loadData();
      } catch (error) {
        console.error('Failed to delete folder:', error);
      }
    }
  };

  const handleFolderDialogSubmit = async (name: string, color: string | null) => {
    if (!app || !activeContextId) return;
    try {
      const client = new AbiClient(app, activeContextId);
      if (folderDialogMode === 'create') {
        await client.createFolder({
          name,
          parent_id: folderDialogParentId,
          color,
        });
        if (folderDialogParentId) {
          setExpandedFolders(prev => new Set([...prev, folderDialogParentId!]));
        }
      } else if (folderDialogFolderId) {
        await client.renameFolder({ folder_id: folderDialogFolderId, name });
        if (color !== folderDialogInitialColor) {
          await client.setFolderColor({ folder_id: folderDialogFolderId, color });
        }
      }
      loadData();
    } catch (error) {
      console.error('Failed to save folder:', error);
    }
  };

  const handleToggleFolder = (folderId: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  // Top-level folder (context-level) handlers
  const handleTopLevelFolderSelect = (contextId: string) => {
    setActiveContext(contextId);
    setSelectedFolderId(null);
    setSearchQuery('');
    setSelectedTag('');
  };

  const handleCreateTopLevelFolder = () => {
    setTopLevelFolderDialogOpen(true);
  };

  const handleTopLevelFolderDialogSubmit = async (name: string, color: string | null) => {
    if (!app || !activeGroupId || !generalContextId) return;
    try {
      const manager = new FolderContextManager(app);
      const contextId = await manager.createFolderContext(
        activeGroupId,
        generalContextId,
        name,
        color ?? undefined,
      );
      // Refresh the top-level folder list
      const updated = await manager.listFolderContexts(generalContextId);
      setTopLevelFolders(updated);
      // Switch into the new folder context
      handleTopLevelFolderSelect(contextId);
    } catch (error) {
      console.error('Failed to create top-level folder:', error);
    }
  };

  const handleTopLevelFolderSettings = (folder: FolderRegistryEntry) => {
    setFolderSettingsTarget(folder);
    setFolderSettingsOpen(true);
  };

  const handleFolderRenamed = (contextId: string, newName: string) => {
    setTopLevelFolders(prev =>
      prev.map(f => f.context_id === contextId ? { ...f, name: newName } : f)
    );
  };

  const handleFolderDeleted = (contextId: string) => {
    setTopLevelFolders(prev => prev.filter(f => f.context_id !== contextId));
    // If the user was inside the deleted folder, navigate to General
    if (activeContextId === contextId && generalContextId) {
      setActiveContext(generalContextId);
    }
  };

  const formatDate = (timestamp: number) => {
    let ms = timestamp;
    if (timestamp > 1e18) {
      ms = Math.floor(timestamp / 1e6);
    } else if (timestamp > 1e15) {
      ms = Math.floor(timestamp / 1e3);
    } else if (timestamp < 1e12) {
      ms = timestamp * 1000;
    }

    const date = new Date(ms);

    if (isNaN(date.getTime())) {
      return 'Unknown date';
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'long' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  // Strip HTML tags and decode entities for preview text
  const stripHtml = (html: string): string => {
    if (!html) return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const text = doc.body.textContent || '';
    return text.replace(/\s+/g, ' ').trim();
  };

  // Get current folder name for breadcrumb
  const getCurrentFolderName = () => {
    if (selectedFolderId === null) return 'All Documents';
    const folder = flatFolders.find(f => f.id === selectedFolderId);
    return folder?.name || 'Unknown Folder';
  };

  // Get parent folder name for dialog
  const getParentFolderName = () => {
    if (!folderDialogParentId) return null;
    const folder = flatFolders.find(f => f.id === folderDialogParentId);
    return folder?.name || null;
  };

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background">
      {/* Sidebar */}
      <aside className="w-72 border-r border-border flex flex-col bg-card">
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <LogoWithText size={28} />
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              {syncStatus === 'synced' && (
                <>
                  <div className="sync-indicator synced" />
                  <span>Synced</span>
                </>
              )}
              {syncStatus === 'syncing' && (
                <>
                  <div className="sync-indicator syncing" />
                  <span>Syncing</span>
                </>
              )}
              {syncStatus === 'offline' && (
                <>
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>Offline</span>
                </>
              )}
            </div>
          </div>

          {/* Workspace Switcher */}
          <WorkspaceSwitcher />

          <div className="flex gap-2 mt-3">
            <Button onClick={createNewDocument} className="flex-1 gap-2">
              <Plus className="w-4 h-4" />
              New Doc
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => handleCreateFolder(null)}
              title="New Folder"
            >
              <FolderPlus className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShareDialogOpen(true)}
              title="Share Workspace"
              disabled={!activeContextId}
            >
              <Share2 className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search documents..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setSelectedTag('');
              }}
              className="w-full pl-9 pr-3 py-2 bg-muted border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
        </div>

        {/* Folder Tree */}
        <div className="flex-1 overflow-auto p-3">
          <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
            <Folder className="w-3.5 h-3.5" />
            Folders
          </div>
          <FolderTree
            folders={folders}
            documents={allDocuments}
            selectedFolderId={selectedFolderId}
            onSelectFolder={(folderId) => {
              setSelectedFolderId(folderId);
              setSearchQuery('');
              setSelectedTag('');
            }}
            onCreateFolder={handleCreateFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            onOpenDocument={openDocument}
            expandedFolders={expandedFolders}
            onToggleFolder={handleToggleFolder}
            topLevelFolders={topLevelFolders}
            activeContextId={activeContextId}
            generalContextId={generalContextId}
            onTopLevelFolderSelect={handleTopLevelFolderSelect}
            onCreateTopLevelFolder={handleCreateTopLevelFolder}
            onTopLevelFolderSettings={handleTopLevelFolderSettings}
            canCreateContext={!!activeGroupId}
          />
        </div>

        {/* Tags */}
        {allTags.length > 0 && (
          <div className="p-3 border-t border-border">
            <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5" />
              Tags
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => {
                    setSelectedTag(selectedTag === tag ? '' : tag);
                    setSearchQuery('');
                    setSelectedFolderId(null);
                  }}
                  className={`px-2 py-1 rounded-full text-xs transition-colors ${
                    selectedTag === tag
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-3 border-t border-border space-y-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="rounded border-border"
            />
            Show archived
          </label>
          <Button variant="ghost" size="sm" onClick={handleLogout} className="w-full justify-start gap-2">
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                {searchQuery ? (
                  <span>Search results for "{searchQuery}"</span>
                ) : selectedTag ? (
                  <span>Tagged with "{selectedTag}"</span>
                ) : (
                  <div className="flex items-center gap-1">
                    <Folder className="w-4 h-4" />
                    <span>{getCurrentFolderName()}</span>
                  </div>
                )}
              </div>
              <h1 className="text-2xl font-bold">
                {documents.length} Document{documents.length !== 1 ? 's' : ''}
              </h1>
            </div>
            <div className="flex items-center gap-4">
              {/* View Toggle */}
              <div className="flex items-center bg-muted rounded-lg p-1">
                <Button
                  variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                  className="h-8 w-8 p-0"
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  className="h-8 w-8 p-0"
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>
              <MembersIndicator contextId={activeContextId} />
              <div className="security-badge">
                <Shield className="w-3.5 h-3.5" />
                <span>End-to-End Encrypted</span>
              </div>
            </div>
          </div>
        </header>

        {/* Documents */}
        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
            </div>
          ) : documents.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No documents yet</h3>
              <p className="text-muted-foreground mb-6">
                {searchQuery || selectedTag
                  ? 'No documents match your search criteria'
                  : 'Create your first document to get started'}
              </p>
              {!searchQuery && !selectedTag && (
                <Button onClick={createNewDocument} className="gap-2">
                  <Plus className="w-4 h-4" />
                  Create Document
                </Button>
              )}
            </div>
          ) : viewMode === 'grid' ? (
            /* Grid View */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className={`group p-4 rounded-xl border transition-all cursor-pointer ${
                    doc.archived
                      ? 'bg-muted/30 border-border/50 opacity-60'
                      : 'bg-card border-border hover:border-primary/30 hover:shadow-elevated'
                  }`}
                  onClick={() => openDocument(doc.id)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-5 h-5 text-primary flex-shrink-0" />
                      <h3 className="font-medium truncate">{doc.title}</h3>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {/* Move to folder submenu */}
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <FolderInput className="w-4 h-4 mr-2" />
                            Move to...
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleMoveDocument(doc.id, null);
                              }}
                            >
                              <Folder className="w-4 h-4 mr-2" />
                              Root
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {flatFolders.map((folder) => (
                              <DropdownMenuItem
                                key={folder.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveDocument(doc.id, folder.id);
                                }}
                                disabled={doc.folder_id === folder.id}
                              >
                                <Folder className="w-4 h-4 mr-2" />
                                {folder.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={(e) => {
                          e.stopPropagation();
                          handleArchive(doc.id, doc.archived);
                        }}>
                          <Archive className="w-4 h-4 mr-2" />
                          {doc.archived ? 'Restore' : 'Archive'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(doc.id);
                          }}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                    {stripHtml(doc.preview) || 'No content'}
                  </p>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {formatDate(doc.updated_at)}
                    </div>
                    {doc.tags.length > 0 && (
                      <div className="flex items-center gap-1">
                        {doc.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag}
                            className="px-1.5 py-0.5 rounded bg-muted text-xs"
                          >
                            {tag}
                          </span>
                        ))}
                        {doc.tags.length > 2 && (
                          <span className="text-xs">+{doc.tags.length - 2}</span>
                        )}
                      </div>
                    )}
                  </div>

                  {doc.archived && (
                    <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Archive className="w-3.5 h-3.5" />
                      Archived
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            /* List View */
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              {/* Table Header */}
              <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <div className="col-span-5">Title</div>
                <div className="col-span-2">Folder</div>
                <div className="col-span-2">Modified</div>
                <div className="col-span-2">Tags</div>
                <div className="col-span-1"></div>
              </div>

              {/* Table Body */}
              <div className="divide-y divide-border">
                {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className={`group grid grid-cols-12 gap-4 px-4 py-3 items-center cursor-pointer transition-colors ${
                      doc.archived
                        ? 'bg-muted/20 opacity-60'
                        : 'hover:bg-muted/30'
                    }`}
                    onClick={() => openDocument(doc.id)}
                  >
                    {/* Title & Preview */}
                    <div className="col-span-5 min-w-0">
                      <div className="flex items-center gap-3">
                        <FileText className={`w-5 h-5 flex-shrink-0 ${doc.archived ? 'text-muted-foreground' : 'text-primary'}`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium truncate">{doc.title}</h3>
                            {doc.archived && (
                              <span className="flex-shrink-0 px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground">
                                Archived
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground truncate mt-0.5">
                            {stripHtml(doc.preview) || 'No content'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Folder */}
                    <div className="col-span-2 min-w-0">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Folder className="w-3.5 h-3.5 flex-shrink-0" />
                        <span className="truncate">
                          {doc.folder_id
                            ? flatFolders.find(f => f.id === doc.folder_id)?.name || 'Unknown'
                            : 'Root'}
                        </span>
                      </div>
                    </div>

                    {/* Modified Date */}
                    <div className="col-span-2">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{formatDate(doc.updated_at)}</span>
                      </div>
                    </div>

                    {/* Tags */}
                    <div className="col-span-2 min-w-0">
                      {doc.tags.length > 0 ? (
                        <div className="flex items-center gap-1 flex-wrap">
                          {doc.tags.slice(0, 2).map((tag) => (
                            <span
                              key={tag}
                              className="px-1.5 py-0.5 rounded bg-muted text-xs text-muted-foreground"
                            >
                              {tag}
                            </span>
                          ))}
                          {doc.tags.length > 2 && (
                            <span className="text-xs text-muted-foreground">
                              +{doc.tags.length - 2}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground/50">—</span>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="col-span-1 flex justify-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {/* Move to folder submenu */}
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <FolderInput className="w-4 h-4 mr-2" />
                              Move to...
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveDocument(doc.id, null);
                                }}
                              >
                                <Folder className="w-4 h-4 mr-2" />
                                Root
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {flatFolders.map((folder) => (
                                <DropdownMenuItem
                                  key={folder.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveDocument(doc.id, folder.id);
                                  }}
                                  disabled={doc.folder_id === folder.id}
                                >
                                  <Folder className="w-4 h-4 mr-2" />
                                  {folder.name}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={(e) => {
                            e.stopPropagation();
                            handleArchive(doc.id, doc.archived);
                          }}>
                            <Archive className="w-4 h-4 mr-2" />
                            {doc.archived ? 'Restore' : 'Archive'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDelete(doc.id);
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Subfolder Dialog */}
      <FolderDialog
        isOpen={folderDialogOpen}
        onClose={() => setFolderDialogOpen(false)}
        onSubmit={handleFolderDialogSubmit}
        mode={folderDialogMode}
        initialName={folderDialogInitialName}
        initialColor={folderDialogInitialColor}
        parentFolderName={getParentFolderName()}
      />

      {/* Top-level Folder Creation Dialog */}
      <FolderDialog
        isOpen={topLevelFolderDialogOpen}
        onClose={() => setTopLevelFolderDialogOpen(false)}
        onSubmit={handleTopLevelFolderDialogSubmit}
        mode="create"
        initialName=""
        initialColor={null}
        parentFolderName={null}
      />

      {/* Share Dialog */}
      {activeContextId && (
        <ShareDialog
          isOpen={shareDialogOpen}
          onClose={() => setShareDialogOpen(false)}
          contextId={activeContextId}
        />
      )}

      {/* Folder Settings Panel */}
      {folderSettingsTarget && activeGroupId && generalContextId && (
        <FolderSettingsPanel
          folder={folderSettingsTarget}
          groupId={activeGroupId}
          generalContextId={generalContextId}
          isOpen={folderSettingsOpen}
          onClose={() => {
            setFolderSettingsOpen(false);
            setFolderSettingsTarget(null);
          }}
          onRenamed={handleFolderRenamed}
          onDeleted={handleFolderDeleted}
        />
      )}
    </div>
  );
};

export default HomePage;
