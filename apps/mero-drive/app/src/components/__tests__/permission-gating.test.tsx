// Permission-gating smoke tests. For each permission-gated
// component, assert the rendered output changes as the mocked
// hook results change. Focus is on the *boundary* — does the
// component hide / disable the right affordance for the right
// caller? — not on the component's full behaviour.
//
// Hooks are mocked at the module level so we don't need a live
// MeroProvider / RegistryProvider tree to mount these components.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useNamespacePermissions } from '@/hooks/useNamespacePermissions';
import { FolderContextMenu } from '@/components/folders/FolderContextMenu';
import { FolderSharingPanel } from '@/components/folders/FolderSharingPanel';
import { FolderVisibilityToggle } from '@/components/folders/FolderVisibilityToggle';
import { NewFolderButton } from '@/components/folders/NewFolderButton';
import { WorkspaceSettingsPanel } from '@/components/admin/WorkspaceSettingsPanel';

vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: vi.fn(),
}));
vi.mock('@/hooks/useNamespacePermissions', () => ({
  useNamespacePermissions: vi.fn(),
}));
vi.mock('@/hooks/useFolderOperations', () => ({
  useFolderOperations: () => ({
    create: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    cascadeTo: vi.fn(),
  }),
}));
vi.mock('@/hooks/useFolderMembership', () => ({
  useFolderMembership: () => ({
    members: [],
    add: vi.fn(),
    remove: vi.fn(),
    refetch: vi.fn(),
    loading: false,
    error: null,
  }),
}));
vi.mock('@/hooks/useReconcile', () => ({
  useReconcile: () => ({
    run: vi.fn(),
    running: false,
    last: null,
    error: null,
  }),
}));
vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: () => ({
    namespaceId: 'ns',
    rootGroupId: 'root',
    selectedFolderId: 'f1',
    setSelectedFolder: vi.fn(),
    setNamespace: vi.fn(),
    clearNamespace: vi.fn(),
  }),
  WorkspaceProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/context/RegistryContext', () => ({
  useRegistry: () => ({
    folders: [],
    registryClient: {},
    loading: false,
    error: null,
    registryContextId: 'ctx',
  }),
}));
vi.mock('@calimero-network/mero-react', () => ({
  useSubgroups: () => ({ subgroups: [], loading: false, error: null, refetch: vi.fn() }),
  useGroupCapabilities: () => ({
    capabilities: 1,
    loading: false,
    error: null,
    refetch: vi.fn(),
    setCapabilities: vi.fn(),
  }),
  useCreateNamespace: () => ({ createNamespace: vi.fn(), loading: false, error: null }),
  useNamespacesForApplication: () => ({
    namespaces: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/components/ui/confirm-dialog', async () => {
  const actual = await vi.importActual<typeof import('@/components/ui/confirm-dialog')>(
    '@/components/ui/confirm-dialog',
  );
  return {
    ...actual,
    useConfirm: () => async () => true,
  };
});

const noFolderPerms = {
  canRead: false,
  canWrite: false,
  canCreateSubfolder: false,
  canRename: false,
  canDelete: false,
  canManageGroup: false,
  canInviteMembers: false,
  canManageMembers: false,
  loading: false,
  error: null,
};

const noNsPerms = {
  canCreateSubgroup: false,
  canManageNamespace: false,
  canManageNamespaceMembers: false,
  loading: false,
  error: null,
};

describe('permission-gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('FolderContextMenu renders nothing when the caller has no caps', () => {
    (useFolderPermissions as ReturnType<typeof vi.fn>).mockReturnValue(noFolderPerms);
    render(
      <FolderContextMenu
        folderId="f1"
        currentVisibility="Inherit"
        onRename={() => undefined}
      />,
    );
    expect(screen.queryByLabelText('Folder actions')).toBeNull();
  });

  it('FolderContextMenu renders the ⋯ trigger when the caller has any cap', () => {
    (useFolderPermissions as ReturnType<typeof vi.fn>).mockReturnValue({
      ...noFolderPerms,
      canRename: true,
    });
    render(
      <FolderContextMenu
        folderId="f1"
        currentVisibility="Inherit"
        onRename={() => undefined}
      />,
    );
    expect(screen.getByLabelText('Folder actions')).toBeTruthy();
  });

  it('FolderSharingPanel hides the invite form without canInviteMembers', () => {
    (useFolderPermissions as ReturnType<typeof vi.fn>).mockReturnValue(noFolderPerms);
    render(<FolderSharingPanel folderId="f1" />);
    expect(screen.queryByPlaceholderText('identity pubkey')).toBeNull();
  });

  it('FolderSharingPanel shows the invite form when canInviteMembers', () => {
    (useFolderPermissions as ReturnType<typeof vi.fn>).mockReturnValue({
      ...noFolderPerms,
      canInviteMembers: true,
    });
    render(<FolderSharingPanel folderId="f1" />);
    expect(screen.getByPlaceholderText('identity pubkey')).toBeTruthy();
  });

  it('FolderVisibilityToggle renders nothing without canManageGroup', () => {
    (useFolderPermissions as ReturnType<typeof vi.fn>).mockReturnValue(noFolderPerms);
    render(<FolderVisibilityToggle folderId="f1" current="Inherit" />);
    expect(screen.queryByText(/Make restricted/i)).toBeNull();
    expect(screen.queryByText(/Make inherited/i)).toBeNull();
  });

  it('NewFolderButton renders nothing for root without canCreateSubgroup', () => {
    (useNamespacePermissions as ReturnType<typeof vi.fn>).mockReturnValue(noNsPerms);
    (useFolderPermissions as ReturnType<typeof vi.fn>).mockReturnValue(noFolderPerms);
    render(<NewFolderButton parentFolderId={null} />);
    expect(screen.queryByRole('button', { name: /New folder/i })).toBeNull();
  });

  it('NewFolderButton renders when the caller has canCreateSubgroup', () => {
    (useNamespacePermissions as ReturnType<typeof vi.fn>).mockReturnValue({
      ...noNsPerms,
      canCreateSubgroup: true,
    });
    (useFolderPermissions as ReturnType<typeof vi.fn>).mockReturnValue(noFolderPerms);
    render(<NewFolderButton parentFolderId={null} />);
    expect(screen.getByRole('button', { name: /New folder/i })).toBeTruthy();
  });

  it('WorkspaceSettingsPanel renders nothing without canManageNamespace', () => {
    (useNamespacePermissions as ReturnType<typeof vi.fn>).mockReturnValue(noNsPerms);
    render(<WorkspaceSettingsPanel />);
    expect(screen.queryByText('Reconcile registry')).toBeNull();
  });

  it('WorkspaceSettingsPanel renders the reconcile action when canManageNamespace', () => {
    (useNamespacePermissions as ReturnType<typeof vi.fn>).mockReturnValue({
      ...noNsPerms,
      canManageNamespace: true,
    });
    render(<WorkspaceSettingsPanel />);
    expect(screen.getByText('Reconcile registry')).toBeTruthy();
  });
});
