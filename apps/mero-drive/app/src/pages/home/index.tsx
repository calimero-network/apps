import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCalimero } from '@calimero-network/calimero-client';
import { AbiClient, FileEntryResponse, FolderTreeItem, FolderResponse } from '@/api/AbiClient';
import { FolderContextManager, type FolderContextWithVisibility } from '@/api/FolderContextManager';
import { FileBlobManager } from '@/api/FileBlobManager';
import { WorkspaceManager } from '@/api/WorkspaceManager';
import { useWorkspace } from '@/context/WorkspaceContext';
import { useGroupPermissions } from '@/hooks/useGroupPermissions';
import {
  computeAllFolderAccess,
  type FolderAccessInfo,
  type FolderAccessContext,
} from '@/utils/folderAccess';
import { isSelfCreatedFolderContext, markSelfCreatedFolderContext } from '@/utils/selfCreatedFolderContexts';
import { hasJoinedContextOnNode, markJoinedContextOnNode } from '@/utils/joinedFolderContexts';
import { LogoWithText } from '@/components/icons/Logo';
import { Button } from '@/components/ui/button';
import { FolderTree } from '@/components/folders/FolderTree';
import { FolderDialog } from '@/components/folders/FolderDialog';
import { FolderSettingsPanel } from '@/components/folders/FolderSettingsPanel';
import { ShareDialog } from '@/components/sharing/ShareDialog';
import { MembersIndicator } from '@/components/sharing/MembersIndicator';
import { MyProfileDialog } from '@/components/profile/MyProfileDialog';
import { AdminPanel } from '@/components/admin/AdminPanel';
import { WorkspaceSwitcher } from '@/components/workspace/WorkspaceSwitcher';
import { FileUploadButton } from '@/components/files/FileUploadButton';
import {
  Search,
  Clock,
  Trash2,
  MoreHorizontal,
  X,
  Download,
  AlertCircle,
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
  Upload,
  File as FileIcon,
  FilePlus,
  HardDrive,
  User,
  FileType,
  Loader2,
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

  const permissions = useGroupPermissions();

  const [files, setFiles] = useState<FileEntryResponse[]>([]);
  const [allFiles, setAllFiles] = useState<FileEntryResponse[]>([]);
  const [folders, setFolders] = useState<FolderTreeItem[]>([]);
  const [flatFolders, setFlatFolders] = useState<FolderResponse[]>([]);
  const [topLevelFolders, setTopLevelFolders] = useState<FolderContextWithVisibility[]>([]);
  const [folderAccessInfos, setFolderAccessInfos] = useState<FolderAccessInfo[]>([]);
  const [topLevelFolderError, setTopLevelFolderError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dataStatus, setDataStatus] = useState<'ready' | 'loading' | 'offline'>('ready');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    const saved = localStorage.getItem('drive-view-mode');
    return (saved === 'list' || saved === 'grid') ? saved : 'grid';
  });
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    const saved = localStorage.getItem('drive-expanded-folders');
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
  const [folderSettingsTarget, setFolderSettingsTarget] = useState<FolderContextWithVisibility | null>(null);

  // Share dialog state
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  // Profile dialog state
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  // Admin panel state
  const [adminPanelOpen, setAdminPanelOpen] = useState(false);
  const [isFilePreviewOpen, setIsFilePreviewOpen] = useState(false);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<FileEntryResponse | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isPreviewDownloading, setIsPreviewDownloading] = useState(false);

  const [pendingFolderJoin, setPendingFolderJoin] = useState<{
    contextId: string;
    name?: string;
  } | null>(null);
  const [isCheckingFolderMembership, setIsCheckingFolderMembership] = useState(false);
  const [pendingJoinInFlight, setPendingJoinInFlight] = useState(false);

  // Persist view mode preference
  useEffect(() => {
    localStorage.setItem('drive-view-mode', viewMode);
  }, [viewMode]);

  // Persist expanded folders
  useEffect(() => {
    localStorage.setItem('drive-expanded-folders', JSON.stringify([...expandedFolders]));
  }, [expandedFolders]);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/');
    }
  }, [isAuthenticated, navigate]);

  // Load top-level folders (with visibility) when workspace changes
  useEffect(() => {
    if (!app || !activeGroupId) return;
    const manager = new FolderContextManager(app);
    setTopLevelFolderError(null);
    manager.listGroupFolderContextsWithVisibility(activeGroupId, generalContextId ?? undefined)
      .then(setTopLevelFolders)
      .catch((err) => {
        console.error('[HomePage] Failed to load top-level folders:', err);
        setTopLevelFolderError('Failed to load top-level folders for this workspace.');
      });
  }, [app, activeGroupId, generalContextId]);

  // Compute per-folder access state once folders and permissions are available
  useEffect(() => {
    if (!app || !activeGroupId || permissions.isLoading || topLevelFolders.length === 0) {
      setFolderAccessInfos([]);
      return;
    }

    let cancelled = false;

    const compute = async () => {
      const restricted = topLevelFolders.filter((f) => f.visibility === 'restricted');
      const allowlistsByContextId = new Map<string, string[]>();

      if (restricted.length > 0) {
        const manager = new FolderContextManager(app);
        await Promise.all(
          restricted.map(async (folder) => {
            try {
              const list = await manager.getContextAllowlist(activeGroupId, folder.context_id);
              allowlistsByContextId.set(folder.context_id, list);
            } catch {
              // Fallback: empty allowlist — the folder stays blocked for non-admins
            }
          }),
        );
      }

      if (cancelled) return;

      const ctx: FolderAccessContext = {
        isAdmin: permissions.isAdmin,
        canJoinOpenContexts: permissions.canJoinOpenContexts,
        currentMemberIdentity: permissions.currentMemberIdentity,
        allowlistsByContextId,
      };

      setFolderAccessInfos(computeAllFolderAccess(topLevelFolders, ctx));
    };

    compute();
    return () => { cancelled = true; };
  }, [
    app,
    activeGroupId,
    topLevelFolders,
    permissions.isLoading,
    permissions.isAdmin,
    permissions.canJoinOpenContexts,
    permissions.currentMemberIdentity,
  ]);

  // Load files and folders — re-runs when active context changes
  const loadData = useCallback(async () => {
    if (!app || !activeContextId) return;

    setIsLoading(true);
    setDataStatus('loading');
    try {
      const client = new AbiClient(app, activeContextId);

      // Load folders
      const [folderTree, folderList] = await Promise.all([
        client.getFolderTree(),
        client.listFolders(),
      ]);
      setFolders(folderTree);
      setFlatFolders(folderList);

      // Load files based on folder selection
      // Root (no folder selected): only files with folder_id null — not everything in context
      let fileList: FileEntryResponse[];
      if (selectedFolderId !== null) {
        fileList = await client.listFilesInFolder({ folder_id: selectedFolderId });
      } else {
        fileList = await client.listFilesInFolder({ folder_id: null });
      }

      // Client-side search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        fileList = fileList.filter(f => f.name.toLowerCase().includes(q));
      }

      setFiles(fileList);

      // Full list for sidebar tree (documents nested under folder nodes)
      const all = await client.listFiles();
      setAllFiles(all);

      setDataStatus('ready');
    } catch (error) {
      console.error('Failed to load data:', error);
      setDataStatus('offline');
    } finally {
      setIsLoading(false);
    }
  }, [app, activeContextId, searchQuery, selectedFolderId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-dismiss folder access errors after 6 seconds
  useEffect(() => {
    if (!topLevelFolderError) return;
    const timer = setTimeout(() => setTopLevelFolderError(null), 6000);
    return () => clearTimeout(timer);
  }, [topLevelFolderError]);

  useEffect(() => {
    if (activeContextId) {
      setUploadError(null);
    }
  }, [activeContextId]);

  useEffect(() => {
    const loadPreviewFile = async () => {
      if (!isFilePreviewOpen || !selectedFileId || !app || !activeContextId) return;
      setIsPreviewLoading(true);
      setPreviewError(null);
      try {
        const client = new AbiClient(app, activeContextId);
        const fileData = await client.getFile({ file_id: selectedFileId });
        if (!fileData) {
          setPreviewError('File not found');
          setPreviewFile(null);
          return;
        }
        setPreviewFile(fileData);
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : 'Failed to load file details');
        setPreviewFile(null);
      } finally {
        setIsPreviewLoading(false);
      }
    };

    loadPreviewFile();
  }, [isFilePreviewOpen, selectedFileId, app, activeContextId]);

  const handleFileUpload = async (file: File) => {
    if (pendingFolderJoin) {
      setUploadError('Join the selected folder first.');
      return;
    }
    if (!app || !activeContextId) {
      console.warn('[HomePage] Upload blocked: app or activeContextId is missing', {
        hasApp: !!app,
        activeContextId,
      });
      if (!app && isAuthenticated) {
        setUploadError(
          'Cannot upload: app client is not ready (missing application id). Try refreshing the page or sign in again.',
        );
      } else if (!activeContextId) {
        setUploadError(
          'Cannot upload: no active context. Select a workspace above, then try again.',
        );
      } else {
        setUploadError('Cannot upload: session not ready.');
      }
      return;
    }
    setUploadError(null);
    setIsUploading(true);
    try {
      const blobManager = new FileBlobManager();
      const { blobId, size } = await blobManager.uploadFile(file);

      const client = new AbiClient(app, activeContextId);
      await client.createFile({
        name: file.name,
        blob_id: blobId,
        mime_type: file.type || 'application/octet-stream',
        size,
        folder_id: selectedFolderId,
      });

      loadData();
    } catch (error) {
      console.error('Failed to upload file:', error);
      setUploadError(
        error instanceof Error ? error.message : 'Upload failed. Check the console for details.',
      );
    } finally {
      setIsUploading(false);
    }
  };

  const openFile = (fileId: string) => {
    setSelectedFileId(fileId);
    setPreviewFile(null);
    setPreviewError(null);
    setIsFilePreviewOpen(true);
  };

  const closeFilePreview = () => {
    setIsFilePreviewOpen(false);
    setSelectedFileId(null);
    setPreviewFile(null);
    setPreviewError(null);
  };

  const handlePreviewDownload = async () => {
    if (!previewFile || !activeContextId) return;
    setIsPreviewDownloading(true);
    try {
      const manager = new FileBlobManager();
      const blob = await manager.downloadFile(previewFile.blob_id, activeContextId);
      manager.triggerBrowserDownload(blob, previewFile.name);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Download failed');
    } finally {
      setIsPreviewDownloading(false);
    }
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!app || !activeContextId) return;
    if (window.confirm('Are you sure you want to delete this file?')) {
      try {
        const client = new AbiClient(app, activeContextId);
        await client.deleteFile({ file_id: fileId });
        loadData();
      } catch (error) {
        console.error('Failed to delete file:', error);
      }
    }
  };

  const handleMoveFile = async (fileId: string, folderId: string | null) => {
    if (!app || !activeContextId) return;
    try {
      const client = new AbiClient(app, activeContextId);
      await client.moveFile({ file_id: fileId, folder_id: folderId });
      loadData();
    } catch (error) {
      console.error('Failed to move file:', error);
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

  // Navigate to the editor before the document exists.  The selected folder is
  // passed as route state so the editor's first createDocument call includes
  // the correct folder_id in the JSON-RPC payload.
  const handleNewDocument = () => {
    navigate('/editor', { state: { folderId: selectedFolderId } });
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
    if (permissions.isLoading) return;
    if (!permissions.canCreateContext) {
      setTopLevelFolderError(
        'You do not have permission to rename folders. Ask an admin to grant you the "create context" capability.',
      );
      return;
    }
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
    if (permissions.isLoading) return;
    if (!permissions.canCreateContext) {
      setTopLevelFolderError(
        'You do not have permission to delete folders. Ask an admin to grant you the "create context" capability.',
      );
      return;
    }
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
    if (folderDialogMode === 'rename') {
      if (permissions.isLoading) return;
      if (!permissions.canCreateContext) {
        setTopLevelFolderError(
          'You do not have permission to rename folders. Ask an admin to grant you the "create context" capability.',
        );
        return;
      }
    }
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
  const enterFolderContext = useCallback(
    (contextId: string) => {
      setPendingFolderJoin(null);
      setActiveContext(contextId);
      setSelectedFolderId(null);
      setSearchQuery('');
    },
    [setActiveContext],
  );

  const handleDismissPendingFolderJoin = useCallback(() => {
    setPendingFolderJoin(null);
  }, []);

  const handleConfirmPendingFolderJoin = async () => {
    if (!app || !activeGroupId || !pendingFolderJoin) {
      return;
    }
    setPendingJoinInFlight(true);
    setTopLevelFolderError(null);
    try {
      const manager = new WorkspaceManager(app);
      await manager.joinContextViaGroup(activeGroupId, pendingFolderJoin.contextId);
      enterFolderContext(pendingFolderJoin.contextId);
    } catch (e) {
      setTopLevelFolderError(
        `Could not join folder: ${e instanceof Error ? e.message : String(e)}`,
      );
    } finally {
      setPendingJoinInFlight(false);
    }
  };

  const handleTopLevelFolderSelect = async (
    contextId: string,
    options?: { skipMembershipCheck?: boolean },
  ) => {
    setTopLevelFolderError(null);

    const isGeneral = contextId === generalContextId;

    if (!isGeneral) {
      const access = folderAccessInfos.find((f) => f.context_id === contextId);
      if (!access) {
        setTopLevelFolderError(
          'Folder access information is not available yet. Please wait a moment and try again.',
        );
        return;
      }
      if (!access.canJoin) {
        setTopLevelFolderError(
          access.visibility === 'restricted'
            ? 'You do not have access to this restricted folder. Only admins, the folder creator, or allowlisted members can open it.'
            : 'You do not have permission to join open folders. Ask an admin to grant you the "join open contexts" capability.',
        );
        return;
      }
    }

    if (isGeneral || options?.skipMembershipCheck) {
      enterFolderContext(contextId);
      return;
    }

    if (permissions.isLoading) {
      setTopLevelFolderError(
        'Permissions are still loading. Please wait a moment and try again.',
      );
      return;
    }

    if (!app || !activeGroupId) {
      setTopLevelFolderError('Workspace is not ready.');
      return;
    }

    if (hasJoinedContextOnNode(activeGroupId, contextId)) {
      enterFolderContext(contextId);
      return;
    }

    setIsCheckingFolderMembership(true);
    try {
      const manager = new WorkspaceManager(app);
      const joined = await manager.isMemberOfContext(activeGroupId, contextId);
      if (joined) {
        markJoinedContextOnNode(activeGroupId, contextId);
        enterFolderContext(contextId);
      } else {
        const folder = topLevelFolders.find((f) => f.context_id === contextId);
        const autoJoinEligible =
          permissions.isAdmin ||
          isSelfCreatedFolderContext(activeGroupId, contextId);
        if (autoJoinEligible) {
          try {
            await manager.joinContextViaGroup(activeGroupId, contextId);
            enterFolderContext(contextId);
          } catch (e) {
            setTopLevelFolderError(
              `Could not open folder: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        } else {
          setPendingFolderJoin({
            contextId,
            name: folder?.name,
          });
        }
      }
    } finally {
      setIsCheckingFolderMembership(false);
    }
  };

  const handleCreateTopLevelFolder = () => {
    if (!permissions.canCreateContext) {
      setTopLevelFolderError('You do not have permission to create new folders. Ask an admin to grant you the "create context" capability.');
      return;
    }
    setTopLevelFolderDialogOpen(true);
  };

  const handleTopLevelFolderDialogSubmit = async (
    name: string,
    color: string | null,
    visibility?: 'open' | 'restricted',
  ) => {
    if (!app || !activeGroupId || !generalContextId) return;
    if (!permissions.canCreateContext) {
      setTopLevelFolderError('You do not have permission to create new folders.');
      return;
    }
    try {
      setTopLevelFolderError(null);
      const manager = new FolderContextManager(app);
      const contextId = await manager.createFolderContext(
        activeGroupId,
        generalContextId,
        name,
        color ?? undefined,
      );

      // Apply chosen visibility (user picked in dialog), fall back to workspace
      // default, then to 'open' if the node doesn't support defaults.
      const chosenVis = visibility ?? null;
      try {
        if (chosenVis) {
          await manager.setFolderVisibility(activeGroupId, contextId, chosenVis);
        } else {
          const wsManager = new WorkspaceManager(app);
          const defaultVis = await wsManager.getDefaultVisibility(activeGroupId);
          await manager.setFolderVisibility(activeGroupId, contextId, defaultVis);
        }
      } catch {
        try {
          await manager.setFolderVisibility(activeGroupId, contextId, chosenVis ?? 'open');
        } catch {
          // Node may not support visibility — proceed without setting it
        }
      }

      // Refresh the top-level folder list (with visibility)
      const updated = await manager.listGroupFolderContextsWithVisibility(activeGroupId, generalContextId);
      setTopLevelFolders(updated);
      markSelfCreatedFolderContext(activeGroupId, contextId);
      // Switch into the new folder context (creator — skip membership gate)
      await handleTopLevelFolderSelect(contextId, { skipMembershipCheck: true });
    } catch (error) {
      console.error('Failed to create top-level folder:', error);
      setTopLevelFolderError(
        `Failed to create top-level folder: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const handleTopLevelFolderSettings = (folder: FolderContextWithVisibility) => {
    if (permissions.isLoading) return;
    if (!permissions.canCreateContext) {
      setTopLevelFolderError(
        'You do not have permission to rename or delete folders. Ask an admin to grant you the "create context" capability.',
      );
      return;
    }
    setFolderSettingsTarget(folder);
    setFolderSettingsOpen(true);
  };

  const handleFolderRenamed = (contextId: string, newName: string) => {
    setTopLevelFolderError(null);
    setTopLevelFolders(prev =>
      prev.map(f => f.context_id === contextId ? { ...f, name: newName } : f)
    );
  };

  const handleTopLevelFolderVisibilityChanged = (contextId: string, mode: 'open' | 'restricted') => {
    setTopLevelFolders(prev =>
      prev.map(f => f.context_id === contextId ? { ...f, visibility: mode } : f)
    );
  };

  const handleFolderDeleted = (contextId: string) => {
    setTopLevelFolderError(null);
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


  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
  };

  const truncateId = (id: string) => {
    if (id.length <= 16) return id;
    return `${id.slice(0, 8)}...${id.slice(-6)}`;
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return '🖼️';
    if (mimeType.startsWith('video/')) return '🎬';
    if (mimeType.startsWith('audio/')) return '🎵';
    if (mimeType === 'application/pdf') return '📄';
    if (mimeType.includes('zip') || mimeType.includes('archive')) return '📦';
    return null;
  };

  // Get current folder name for breadcrumb
  const getCurrentFolderName = () => {
    if (selectedFolderId === null) return 'All Files';
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
              {dataStatus === 'ready' && (
                <>
                  <div className="w-2 h-2 rounded-full bg-green-500 opacity-80" />
                  <span>Ready</span>
                </>
              )}
              {dataStatus === 'loading' && (
                <>
                  <div className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  <span>Loading</span>
                </>
              )}
              {dataStatus === 'offline' && (
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
            <Button
              onClick={handleNewDocument}
              disabled={!activeContextId || !!pendingFolderJoin}
              className="flex-1 gap-1.5"
            >
              <FilePlus className="w-4 h-4" />
              New Document
            </Button>
            <FileUploadButton
              onFileSelected={handleFileUpload}
              disabled={!activeContextId || isUploading || !!pendingFolderJoin}
              variant="icon"
            />
            <Button
              variant="outline"
              size="icon"
              onClick={handleCreateTopLevelFolder}
              title="New Root Folder"
            >
              <FolderPlus className="w-4 h-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setShareDialogOpen(true)}
              title={permissions.canInviteMembers ? 'Share Workspace' : 'You do not have permission to invite members'}
              disabled={!activeContextId || !permissions.canInviteMembers}
            >
              <Share2 className="w-4 h-4" />
            </Button>
          </div>
          {uploadError && (
            <p className="text-xs text-destructive mt-2">{uploadError}</p>
          )}
        </div>

        {/* Search */}
        <div className="p-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search files..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
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
          {isCheckingFolderMembership && (
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
              Checking folder access…
            </p>
          )}
          {topLevelFolderError && (
            <div className="flex items-start gap-2 p-2 mb-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-xs">
              <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              <span className="flex-1">{topLevelFolderError}</span>
              <button
                className="flex-shrink-0 hover:opacity-70"
                onClick={() => setTopLevelFolderError(null)}
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
          <FolderTree
            folders={folders}
            documents={allFiles}
            selectedFolderId={selectedFolderId}
            onSelectFolder={(folderId) => {
              setSelectedFolderId(folderId);
              setSearchQuery('');
            }}
            onCreateFolder={handleCreateFolder}
            onRenameFolder={handleRenameFolder}
            onDeleteFolder={handleDeleteFolder}
            onOpenDocument={openFile}
            onCreateDocument={(folderId) => {
              navigate('/editor', { state: { folderId } });
            }}
            expandedFolders={expandedFolders}
            onToggleFolder={handleToggleFolder}
            topLevelFolders={folderAccessInfos}
            activeContextId={activeContextId}
            generalContextId={generalContextId}
            onTopLevelFolderSelect={handleTopLevelFolderSelect}
            onCreateTopLevelFolder={handleCreateTopLevelFolder}
            onTopLevelFolderSettings={handleTopLevelFolderSettings}
            onTopLevelFolderVisibilityChanged={handleTopLevelFolderVisibilityChanged}
            canCreateContext={permissions.canCreateContext}
          />
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border space-y-1">
          <Button variant="ghost" size="sm" onClick={() => setProfileDialogOpen(true)} className="w-full justify-start gap-2">
            <User className="w-4 h-4" />
            My Profile
          </Button>
          {permissions.isAdmin && (
            <Button variant="ghost" size="sm" onClick={() => setAdminPanelOpen(true)} className="w-full justify-start gap-2">
              <Shield className="w-4 h-4" />
              Workspace Admin
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={handleLogout} className="w-full justify-start gap-2">
            <LogOut className="w-4 h-4" />
            Sign Out
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        {pendingFolderJoin && (
          <div className="border-b border-border bg-muted/50 px-6 py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-foreground">
              <span className="font-medium">
                Join folder &ldquo;{pendingFolderJoin.name ?? 'This folder'}&rdquo;
              </span>{' '}
              to open it on this node.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDismissPendingFolderJoin}
                disabled={pendingJoinInFlight}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void handleConfirmPendingFolderJoin()}
                disabled={pendingJoinInFlight}
              >
                {pendingJoinInFlight ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Joining…
                  </>
                ) : (
                  'Join this folder'
                )}
              </Button>
            </div>
          </div>
        )}
        {/* Header */}
        <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-border px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                {searchQuery ? (
                  <span>Search results for &ldquo;{searchQuery}&rdquo;</span>
                ) : (
                  <div className="flex items-center gap-1">
                    <Folder className="w-4 h-4" />
                    <span>{getCurrentFolderName()}</span>
                  </div>
                )}
              </div>
              <h1 className="text-2xl font-bold">
                {files.length} File{files.length !== 1 ? 's' : ''}
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

        {/* Files */}
        <div className="p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary"></div>
            </div>
          ) : !activeContextId ? (
            <div className="text-center py-12">
              <Folder className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No workspace selected</h3>
              <p className="text-muted-foreground">
                Select a workspace to view files
              </p>
            </div>
          ) : pendingFolderJoin ? (
            <div className="text-center py-16 max-w-md mx-auto">
              <Folder className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">Join this folder to continue</h3>
              <p className="text-muted-foreground text-sm">
                Use &ldquo;Join this folder&rdquo; in the banner above to open{' '}
                <span className="font-medium text-foreground">
                  {pendingFolderJoin.name ?? 'this folder'}
                </span>{' '}
                on this node. You can upload files after joining.
              </p>
            </div>
          ) : files.length === 0 ? (
            <div className="text-center py-12">
              <HardDrive className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No files yet</h3>
              <p className="text-muted-foreground mb-6">
                {searchQuery
                  ? 'No files match your search'
                  : 'Create a document or upload a file to get started'}
              </p>
              {!searchQuery && (
                <div className="flex items-center justify-center gap-3">
                  <Button
                    onClick={handleNewDocument}
                    disabled={!activeContextId || !!pendingFolderJoin}
                    className="gap-2"
                  >
                    <FilePlus className="w-4 h-4" />
                    New Document
                  </Button>
                  <FileUploadButton
                    onFileSelected={handleFileUpload}
                    disabled={!activeContextId || isUploading || !!pendingFolderJoin}
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        Upload File
                      </>
                    )}
                  </FileUploadButton>
                </div>
              )}
            </div>
          ) : viewMode === 'grid' ? (
            /* Grid View */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {files.map((file) => (
                <div
                  key={file.id}
                  className="group p-4 rounded-xl border bg-card border-border hover:border-primary/30 hover:shadow-elevated transition-all cursor-pointer"
                  onClick={() => openFile(file.id)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                        {getFileIcon(file.mime_type) ? (
                          <span className="text-lg">{getFileIcon(file.mime_type)}</span>
                        ) : (
                          <FileIcon className="w-5 h-5 text-primary" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <h3 className="font-medium truncate">{file.name}</h3>
                        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                      </div>
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
                        <DropdownMenuSub>
                          <DropdownMenuSubTrigger>
                            <FolderInput className="w-4 h-4 mr-2" />
                            Move to...
                          </DropdownMenuSubTrigger>
                          <DropdownMenuSubContent>
                            {file.folder_id !== null && (
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveFile(file.id, null);
                                }}
                              >
                                <Folder className="w-4 h-4 mr-2" />
                                Root
                              </DropdownMenuItem>
                            )}
                            {file.folder_id !== null && flatFolders.length > 0 && (
                              <DropdownMenuSeparator />
                            )}
                            {flatFolders.map((folder) => (
                              <DropdownMenuItem
                                key={folder.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleMoveFile(file.id, folder.id);
                                }}
                                disabled={file.folder_id === folder.id}
                              >
                                <Folder className="w-4 h-4 mr-2" />
                                {folder.name}
                              </DropdownMenuItem>
                            ))}
                            {file.folder_id === null && flatFolders.length === 0 && (
                              <DropdownMenuItem disabled>
                                No other folders
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteFile(file.id);
                          }}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {formatDate(file.created_at)}
                    </div>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted">
                      {file.mime_type.split('/').pop()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            /* List View */
            <div className="bg-card rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-12 gap-4 px-4 py-3 bg-muted/50 border-b border-border text-xs font-medium text-muted-foreground uppercase tracking-wider">
                <div className="col-span-5">Name</div>
                <div className="col-span-2">Size</div>
                <div className="col-span-2">Modified</div>
                <div className="col-span-2">Type</div>
                <div className="col-span-1"></div>
              </div>

              <div className="divide-y divide-border">
                {files.map((file) => (
                  <div
                    key={file.id}
                    className="group grid grid-cols-12 gap-4 px-4 py-3 items-center cursor-pointer transition-colors hover:bg-muted/30"
                    onClick={() => openFile(file.id)}
                  >
                    <div className="col-span-5 min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                          {getFileIcon(file.mime_type) ? (
                            <span className="text-sm">{getFileIcon(file.mime_type)}</span>
                          ) : (
                            <FileIcon className="w-4 h-4 text-primary" />
                          )}
                        </div>
                        <h3 className="font-medium truncate">{file.name}</h3>
                      </div>
                    </div>

                    <div className="col-span-2">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <HardDrive className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{formatFileSize(file.size)}</span>
                      </div>
                    </div>

                    <div className="col-span-2">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>{formatDate(file.created_at)}</span>
                      </div>
                    </div>

                    <div className="col-span-2 min-w-0">
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                        {file.mime_type.split('/').pop()}
                      </span>
                    </div>

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
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                              <FolderInput className="w-4 h-4 mr-2" />
                              Move to...
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                              {file.folder_id !== null && (
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveFile(file.id, null);
                                  }}
                                >
                                  <Folder className="w-4 h-4 mr-2" />
                                  Root
                                </DropdownMenuItem>
                              )}
                              {file.folder_id !== null && flatFolders.length > 0 && (
                                <DropdownMenuSeparator />
                              )}
                              {flatFolders.map((folder) => (
                                <DropdownMenuItem
                                  key={folder.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveFile(file.id, folder.id);
                                  }}
                                  disabled={file.folder_id === folder.id}
                                >
                                  <Folder className="w-4 h-4 mr-2" />
                                  {folder.name}
                                </DropdownMenuItem>
                              ))}
                              {file.folder_id === null && flatFolders.length === 0 && (
                                <DropdownMenuItem disabled>
                                  No other folders
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteFile(file.id);
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
        showVisibility
        initialVisibility="open"
      />

      {/* Share Dialog */}
      {activeGroupId && (
        <ShareDialog
          isOpen={shareDialogOpen}
          onClose={() => setShareDialogOpen(false)}
          groupId={activeGroupId}
        />
      )}

      {/* Folder Settings Panel */}
      {folderSettingsTarget && activeGroupId && generalContextId && (
        <FolderSettingsPanel
          folder={folderSettingsTarget}
          groupId={activeGroupId}
          generalContextId={generalContextId}
          isOpen={folderSettingsOpen}
          allowRenameDelete={permissions.canCreateContext}
          onClose={() => {
            setFolderSettingsOpen(false);
            setFolderSettingsTarget(null);
          }}
          onRenamed={handleFolderRenamed}
          onDeleted={handleFolderDeleted}
          onVisibilityChanged={handleTopLevelFolderVisibilityChanged}
        />
      )}

      {/* My Profile Dialog */}
      <MyProfileDialog
        isOpen={profileDialogOpen}
        onClose={() => setProfileDialogOpen(false)}
      />

      {/* Admin Panel */}
      <AdminPanel
        isOpen={adminPanelOpen}
        onClose={() => setAdminPanelOpen(false)}
      />

      {isFilePreviewOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={closeFilePreview}
        >
          <div
            className="w-full max-w-2xl rounded-xl border border-border bg-card shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-lg font-semibold truncate pr-4">
                {previewFile?.name ?? 'File details'}
              </h2>
              <Button variant="ghost" size="icon" onClick={closeFilePreview}>
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="p-5 space-y-4">
              {isPreviewLoading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                </div>
              )}

              {!isPreviewLoading && (previewError || !previewFile) && (
                <div className="flex items-center gap-2 rounded-lg bg-destructive/10 text-destructive px-3 py-2">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">{previewError ?? 'File not found'}</span>
                </div>
              )}

              {!isPreviewLoading && !previewError && previewFile && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <HardDrive className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Size</p>
                        <p className="font-medium">{formatFileSize(previewFile.size)}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <FileType className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Type</p>
                        <p className="font-medium">{previewFile.mime_type}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <Clock className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Uploaded</p>
                        <p className="font-medium">{formatDate(previewFile.created_at)}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                      <User className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Uploaded by</p>
                        <p className="font-medium font-mono text-sm">{truncateId(previewFile.uploaded_by)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button onClick={handlePreviewDownload} disabled={isPreviewDownloading} className="gap-2">
                      {isPreviewDownloading ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Download className="w-4 h-4" />
                      )}
                      Download
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default HomePage;
