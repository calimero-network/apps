import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomePage from './index';

type FolderContextWithVisibility = {
  context_id: string;
  name: string;
  color: string | null;
  created_at: number;
  visibility: 'open' | 'restricted';
};

const mockApp = { id: 'test-app' };
const mockNavigate = vi.fn();
const mockLogout = vi.fn();
const mockSetActiveContext = vi.fn();
const mockListGroupFolderContextsWithVisibility = vi.fn();
const mockGetContextAllowlist = vi.fn();

const workspaceState = {
  activeContextId: 'general-1',
  generalContextId: 'general-1',
  activeGroupId: 'group-1',
};

const mockGetFolderTree = vi.fn();
const mockListFolders = vi.fn();
const mockListFilesInFolder = vi.fn();
const mockListFiles = vi.fn();
const mockGetDocumentsInFolder = vi.fn();
const mockListDocuments = vi.fn();
const mockCreateFolder = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('@calimero-network/calimero-client', () => ({
  useCalimero: () => ({
    app: mockApp,
    logout: mockLogout,
    isAuthenticated: true,
  }),
}));

vi.mock('@/api/AbiClient', () => ({
  AbiClient: class {
    getFolderTree = mockGetFolderTree;
    listFolders = mockListFolders;
    listFilesInFolder = mockListFilesInFolder;
    listFiles = mockListFiles;
    getDocumentsInFolder = mockGetDocumentsInFolder;
    listDocuments = mockListDocuments;
    createFolder = mockCreateFolder;
  },
}));

vi.mock('@/api/FolderContextManager', () => ({
  FolderContextManager: class {
    listGroupFolderContextsWithVisibility = mockListGroupFolderContextsWithVisibility;
    getContextAllowlist = mockGetContextAllowlist;
  },
}));

vi.mock('@/api/FileBlobManager', () => ({
  FileBlobManager: class {},
}));

vi.mock('@/api/WorkspaceManager', () => ({
  WorkspaceManager: class {},
}));

vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeContextId: workspaceState.activeContextId,
    generalContextId: workspaceState.generalContextId,
    activeGroupId: workspaceState.activeGroupId,
    setActiveContext: mockSetActiveContext,
  }),
}));

vi.mock('@/hooks/useGroupPermissions', () => ({
  useGroupPermissions: () => ({
    isLoading: false,
    isAdmin: true,
    canCreateContext: true,
    canInviteMembers: true,
    canJoinOpenContexts: true,
    currentMemberIdentity: 'member-1',
  }),
}));

vi.mock('@/utils/folderAccess', () => ({
  computeAllFolderAccess: (folders: FolderContextWithVisibility[]) =>
    folders.map((folder) => ({
      ...folder,
      accessLevel: 'open_joinable' as const,
      isCreator: false,
      isAllowlisted: false,
      canJoin: true,
    })),
}));

vi.mock('@/utils/selfCreatedFolderContexts', () => ({
  isSelfCreatedFolderContext: () => false,
  markSelfCreatedFolderContext: vi.fn(),
}));

vi.mock('@/utils/joinedFolderContexts', () => ({
  hasJoinedContextOnNode: () => true,
  markJoinedContextOnNode: vi.fn(),
}));

vi.mock('@/components/icons/Logo', () => ({
  LogoWithText: () => <div>Mero Drive</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/folders/FolderDialog', () => ({
  FolderDialog: ({
    isOpen,
    onSubmit,
    mode,
  }: {
    isOpen: boolean;
    onSubmit: (name: string, color: string | null) => void;
    mode: 'create' | 'rename';
  }) =>
    isOpen ? (
      <button
        type="button"
        data-testid={`folder-dialog-submit-${mode}`}
        onClick={() => onSubmit('New Folder', null)}
      >
        Submit Folder Dialog
      </button>
    ) : null,
}));

vi.mock('@/components/folders/FolderSettingsPanel', () => ({
  FolderSettingsPanel: () => null,
}));

vi.mock('@/components/sharing/ShareDialog', () => ({
  ShareDialog: () => null,
}));

vi.mock('@/components/sharing/MembersIndicator', () => ({
  MembersIndicator: () => <div>Members</div>,
}));

vi.mock('@/components/profile/MyProfileDialog', () => ({
  MyProfileDialog: () => null,
}));

vi.mock('@/components/admin/AdminPanel', () => ({
  AdminPanel: () => null,
}));

vi.mock('@/components/workspace/WorkspaceSwitcher', () => ({
  WorkspaceSwitcher: () => <div>Workspace Switcher</div>,
}));

vi.mock('@/components/files/FileUploadButton', () => ({
  FileUploadButton: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children ?? 'Upload File'}</button>
  ),
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" {...props}>
      {children}
    </button>
  ),
  DropdownMenuSeparator: () => null,
  DropdownMenuSub: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownMenuSubTrigger: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DropdownMenuSubContent: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

describe('HomePage document listing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    workspaceState.activeContextId = 'general-1';
    workspaceState.generalContextId = 'general-1';
    workspaceState.activeGroupId = 'group-1';
    localStorage.setItem('drive-expanded-folders', JSON.stringify(['folder-1']));
    mockListGroupFolderContextsWithVisibility.mockResolvedValue([]);
    mockGetContextAllowlist.mockResolvedValue([]);

    mockGetFolderTree.mockResolvedValue([
      {
        id: 'folder-1',
        name: 'Specs',
        parent_id: null,
        color: null,
        document_count: 1,
        children: [],
      },
    ]);
    mockListFolders.mockResolvedValue([
      {
        id: 'folder-1',
        name: 'Specs',
        parent_id: null,
        created_at: 1710000000,
        updated_at: 1710000000,
        color: null,
        document_count: 1,
        subfolder_count: 0,
      },
    ]);
    mockListFilesInFolder.mockResolvedValue([
      {
        id: 'file-1',
        name: 'Project Brief.pdf',
        blob_id: 'blob-1',
        mime_type: 'application/pdf',
        size: 1024,
        folder_id: 'folder-1',
        created_at: 1710000000,
        updated_at: 1710000000,
        uploaded_by: 'user-1',
      },
    ]);
    mockListFiles.mockResolvedValue([
      {
        id: 'file-1',
        name: 'Project Brief.pdf',
        blob_id: 'blob-1',
        mime_type: 'application/pdf',
        size: 1024,
        folder_id: 'folder-1',
        created_at: 1710000000,
        updated_at: 1710000000,
        uploaded_by: 'user-1',
      },
    ]);
    mockGetDocumentsInFolder.mockResolvedValue([
      {
        id: 'doc-1',
        title: 'Draft Proposal',
        author: 'user-1',
        created_at: 1710000000,
        updated_at: 1710000000,
        tags: [],
        archived: false,
        preview: 'Saved draft',
        folder_id: 'folder-1',
      },
    ]);
    mockListDocuments.mockResolvedValue([
      {
        id: 'doc-1',
        title: 'Draft Proposal',
        author: 'user-1',
        created_at: 1710000000,
        updated_at: 1710000000,
        tags: [],
        archived: false,
        preview: 'Saved draft',
        folder_id: 'folder-1',
      },
    ]);
    mockCreateFolder.mockResolvedValue('folder-2');
  });

  it('shows saved documents alongside files and opens the document editor', async () => {
    const user = userEvent.setup();

    render(<HomePage />);

    const documentEntries = await screen.findAllByText('Draft Proposal');
    expect(documentEntries.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Project Brief.pdf').length).toBeGreaterThan(0);
    expect(mockGetDocumentsInFolder).toHaveBeenCalledWith({
      folder_id: null,
      include_archived: false,
    });
    expect(mockListDocuments).toHaveBeenCalledWith({
      include_archived: false,
    });

    await user.click(documentEntries[0]!);

    expect(mockNavigate).toHaveBeenCalledWith('/editor/doc-1');
  });

  it('does not render the header-level New Root Folder button', () => {
    render(<HomePage />);

    expect(screen.queryByTitle('New Root Folder')).toBeNull();
  });

  it('creates a new document in the newly created folder', async () => {
    const user = userEvent.setup();

    render(<HomePage />);

    await user.click(screen.getByTitle('New Subfolder'));
    await user.click(screen.getByTestId('folder-dialog-submit-create'));
    await waitFor(() => {
      expect(mockCreateFolder).toHaveBeenCalledWith({
        name: 'New Folder',
        parent_id: null,
        color: null,
      });
    });

    await user.click(screen.getAllByText('New Document')[0]!);

    expect(mockNavigate).toHaveBeenLastCalledWith('/editor', {
      state: { folderId: 'folder-2' },
    });
  });

  it('ignores stale top-level folder loads when generalContextId becomes available', async () => {
    let resolveFirstRequest: ((value: FolderContextWithVisibility[]) => void) | undefined;
    workspaceState.generalContextId = null as unknown as string;
    mockListGroupFolderContextsWithVisibility
      .mockImplementationOnce(
        () =>
          new Promise<FolderContextWithVisibility[]>((resolve) => {
            resolveFirstRequest = resolve;
          }),
      )
      .mockResolvedValueOnce([]);

    const { rerender } = render(<HomePage />);

    await waitFor(() => {
      expect(mockListGroupFolderContextsWithVisibility).toHaveBeenNthCalledWith(1, 'group-1', undefined);
    });

    workspaceState.generalContextId = 'general-1';
    rerender(<HomePage />);

    await waitFor(() => {
      expect(mockListGroupFolderContextsWithVisibility).toHaveBeenNthCalledWith(2, 'group-1', 'general-1');
    });

    await waitFor(() => {
      expect(screen.getAllByText('General')).toHaveLength(1);
    });

    await act(async () => {
      resolveFirstRequest?.([
        {
          context_id: 'general-1',
          name: 'General',
          color: null,
          created_at: 0,
          visibility: 'open',
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.getAllByText('General')).toHaveLength(1);
    });
  });

  it('clears stale top-level folders immediately when switching to a new workspace', async () => {
    let resolveSecondRequest: ((value: FolderContextWithVisibility[]) => void) | undefined;
    mockListGroupFolderContextsWithVisibility
      .mockResolvedValueOnce([
        {
          context_id: 'old-folder',
          name: 'General',
          color: null,
          created_at: 0,
          visibility: 'open',
        },
      ])
      .mockImplementationOnce(
        () =>
          new Promise<FolderContextWithVisibility[]>((resolve) => {
            resolveSecondRequest = resolve;
          }),
      );

    const { rerender } = render(<HomePage />);

    await waitFor(() => {
      expect(screen.getAllByText('General')).toHaveLength(2);
    });

    workspaceState.activeGroupId = 'group-2';
    workspaceState.generalContextId = 'general-2';
    workspaceState.activeContextId = 'general-2';
    rerender(<HomePage />);

    await waitFor(() => {
      expect(mockListGroupFolderContextsWithVisibility).toHaveBeenNthCalledWith(2, 'group-2', 'general-2');
    });

    expect(screen.getAllByText('General')).toHaveLength(1);

    await act(async () => {
      resolveSecondRequest?.([
        {
          context_id: 'test-folder',
          name: 'TEST',
          color: null,
          created_at: 0,
          visibility: 'open',
        },
      ]);
    });

    await screen.findByText('TEST');
    expect(screen.getAllByText('General')).toHaveLength(1);
  });
});
