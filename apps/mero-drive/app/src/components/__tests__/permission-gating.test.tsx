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
import { render, screen, fireEvent } from '@testing-library/react';
import { useFolderPermissions } from '@/hooks/useFolderPermissions';
import { useNamespacePermissions } from '@/hooks/useNamespacePermissions';
import { FolderContextMenu } from '@/components/folders/FolderContextMenu';
import { FolderSharingPanel } from '@/components/folders/FolderSharingPanel';
import { FolderVisibilityToggle } from '@/components/folders/FolderVisibilityToggle';
import { NewFolderButton } from '@/components/folders/NewFolderButton';
import { WorkspaceSettingsPanel } from '@/components/admin/WorkspaceSettingsPanel';
import { MemberDefaultsPanel } from '@/components/admin/MemberDefaultsPanel';
import {
  FolderRoleSelect,
  FOLDER_ROLE_PRESETS,
} from '@/components/admin/FolderRoleSelect';

vi.mock('@/hooks/useFolderPermissions', () => ({
  useFolderPermissions: vi.fn(),
}));
// Force MemberLabel into its fallback (truncated-pubkey) path so any
// existing assertion that looks for the truncate text still matches.
// The display-name feature is exercised by useMemberDisplayName.test.ts
// + MemberLabel.test.tsx directly.
vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: () => ({
    name: null,
    loading: false,
    error: null,
    setName: vi.fn(),
  }),
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
vi.mock('@/hooks/useFolderRole', () => ({
  useFolderRole: () => ({
    role: 'Editor',
    loading: false,
    error: null,
    registryAvailable: true,
    setRole: vi.fn(),
    clearRole: vi.fn(),
    refetch: vi.fn(),
  }),
  useFolderRoles: () => ({
    entries: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/hooks/useRegistryAdmin', () => ({
  useRegistryAdmin: () => ({
    owner: 'pk',
    managers: [],
    isOwnerOrManager: true,
    isOwner: true,
    loading: false,
    error: null,
    addManager: vi.fn(),
    removeManager: vi.fn(),
    claimOwner: vi.fn(),
    refetch: vi.fn(),
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
// Single useDriveWorkspace mock replaces the old WorkspaceContext +
// RegistryContext mocks. Fields match useDriveWorkspace's return
// shape; each test overrides only what it cares about.
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    applicationId: 'app',
    selfIdentity: 'pk',
    namespaceMemberNames: {},
    namespaces: [],
    selectedNamespaceId: 'ns',
    namespaceId: 'ns',
    rootGroupId: 'ns',
    selectNamespace: vi.fn(),
    clearNamespace: vi.fn(),
    createWorkspace: vi.fn().mockResolvedValue('ns-new'),
    createWorkspaceLoading: false,
    createWorkspaceError: null,
    registryContextId: 'ctx',
    registryClient: {},
    folders: [],
    registryAdmin: {
      owner: 'pk',
      managers: [],
      isOwnerOrManager: true,
      isOwner: true,
      loading: false,
      error: null,
      addManager: vi.fn(),
      removeManager: vi.fn(),
      claimOwner: vi.fn(),
      refetch: vi.fn(),
    },
    selectedFolderId: 'f1',
    setSelectedFolder: vi.fn(),
    loading: false,
    stage: 'ready',
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock('@calimero-network/mero-react', () => ({
  useSubscription: vi.fn(),
  useSubgroups: () => ({ subgroups: [], loading: false, error: null, refetch: vi.fn() }),
  useGroupCapabilities: () => ({
    capabilities: 1,
    loading: false,
    error: null,
    refetch: vi.fn(),
    setCapabilities: vi.fn(),
  }),
  // MemberPicker (adopted by WorkspaceSettingsPanel + FolderSharingPanel)
  // calls useGroupMembers for its candidate list. Empty list keeps the
  // dropdown closed so existing assertions are unaffected.
  useGroupMembers: () => ({
    members: [],
    selfIdentity: 'pk',
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateNamespace: () => ({ createNamespace: vi.fn(), loading: false, error: null }),
  useNamespacesForApplication: () => ({
    namespaces: [],
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
  // Stable reference — used by invite/membership hooks. Returns
  // stubbed admin methods; tests don't exercise real creation flows.
  useMero: () => ({
    mero: {
      admin: {
        createNamespaceInvitation: vi.fn(),
        createGroupInvitation: vi.fn(),
        joinNamespace: vi.fn(),
        joinGroup: vi.fn(),
        listGroupMembers: vi.fn().mockResolvedValue({ members: [] }),
        getMemberCapabilities: vi.fn().mockResolvedValue({ capabilities: 0 }),
      },
    },
    nodeUrl: 'http://localhost:2528',
  }),
  useAddGroupMembers: () => ({ addGroupMembers: vi.fn(), loading: false, error: null }),
  useRemoveGroupMembers: () => ({ removeGroupMembers: vi.fn(), loading: false, error: null }),
  useSetSubgroupVisibility: () => ({
    setSubgroupVisibility: vi.fn(),
    loading: false,
    error: null,
  }),
  useDefaultCapabilities: () => ({
    defaultCapabilities: 37,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSetDefaultCapabilities: () => ({
    setDefaultCapabilities: vi.fn(),
    loading: false,
    error: null,
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
  isMember: false,
  canCreateSubfolder: false,
  canRename: false,
  canManageVisibility: false,
  canDelete: false,
  canInviteMembers: false,
  canManageMembers: false,
  canEditDocs: false,
  canManagePermissions: false,
  role: null,
  roleLoading: false,
  roleError: null,
  canManageGroup: false,
  loading: false,
  error: null,
};

const noNsPerms = {
  canCreateFolder: false,
  canJoinOpenFolders: false,
  canCreateContext: false,
  canManageVisibility: false,
  canManageMetadata: false,
  canInviteMembers: false,
  canManageMembers: false,
  canManageNamespace: false,
  loading: false,
  error: null,
};

describe('permission-gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('FolderContextMenu always renders the ⋯ trigger (read-only viewers can open Info)', () => {
    (useFolderPermissions as ReturnType<typeof vi.fn>).mockReturnValue(noFolderPerms);
    render(
      <FolderContextMenu
        folderId="f1"
        currentVisibility="Open"
        onRename={() => undefined}
      />,
    );
    // Trigger always renders so read-only members can open Info.
    expect(screen.getByLabelText('Folder actions')).toBeTruthy();
    // Open the dropdown so menu items are in the DOM.
    // Radix DropdownMenu responds to pointerdown to open in jsdom.
    const trigger = screen.getByLabelText('Folder actions');
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(trigger);
    // Info is always present — read-only members can reach it.
    expect(screen.getByRole('menuitem', { name: /Info/ })).toBeTruthy();
    // Permission-gated items are absent for a caller with no caps.
    expect(screen.queryByRole('menuitem', { name: /Rename/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /Delete/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /New subfolder/ })).toBeNull();
  });

  it('FolderContextMenu renders the ⋯ trigger when the caller has any cap', () => {
    (useFolderPermissions as ReturnType<typeof vi.fn>).mockReturnValue({
      ...noFolderPerms,
      canRename: true,
    });
    render(
      <FolderContextMenu
        folderId="f1"
        currentVisibility="Open"
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

  it('FolderRoleSelect lists the Viewer / Editor / Manager presets', () => {
    render(
      <FolderRoleSelect role="Editor" folderCaps={0} onChange={() => undefined} />,
    );
    for (const p of FOLDER_ROLE_PRESETS) {
      expect(
        screen.getByRole('option', { name: p.label }),
      ).toBeTruthy();
    }
  });

  it("FolderRoleSelect shows 'Custom' for an off-preset (role, caps) pair", () => {
    render(
      <FolderRoleSelect
        role="Editor"
        folderCaps={0xff}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('option', { name: 'Custom' })).toBeTruthy();
  });

  it('FolderVisibilityToggle renders nothing without canManageVisibility', () => {
    (useFolderPermissions as ReturnType<typeof vi.fn>).mockReturnValue(noFolderPerms);
    render(<FolderVisibilityToggle folderId="f1" current="Open" />);
    expect(screen.queryByText(/Make restricted/i)).toBeNull();
    expect(screen.queryByText(/Make open/i)).toBeNull();
  });

  it('NewFolderButton renders nothing for root without canCreateFolder', () => {
    (useNamespacePermissions as ReturnType<typeof vi.fn>).mockReturnValue(noNsPerms);
    (useFolderPermissions as ReturnType<typeof vi.fn>).mockReturnValue(noFolderPerms);
    render(<NewFolderButton parentFolderId={null} />);
    expect(screen.queryByRole('button', { name: /New folder/i })).toBeNull();
  });

  it('NewFolderButton renders when the caller has canCreateFolder', () => {
    (useNamespacePermissions as ReturnType<typeof vi.fn>).mockReturnValue({
      ...noNsPerms,
      canCreateFolder: true,
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

  it('WorkspaceSettingsPanel renders the reconcile + owner/managers sections when canManageNamespace', () => {
    (useNamespacePermissions as ReturnType<typeof vi.fn>).mockReturnValue({
      ...noNsPerms,
      canManageNamespace: true,
    });
    render(<WorkspaceSettingsPanel />);
    expect(screen.getByText('Reconcile registry')).toBeTruthy();
    expect(screen.getByText(/Registry owner/i)).toBeTruthy();
  });

  it('MemberDefaultsPanel renders nothing without canManageNamespace', () => {
    (useNamespacePermissions as ReturnType<typeof vi.fn>).mockReturnValue(
      noNsPerms,
    );
    render(<MemberDefaultsPanel />);
    expect(screen.queryByText('Member defaults')).toBeNull();
  });

  it('MemberDefaultsPanel renders the cap checklist when canManageNamespace', () => {
    (useNamespacePermissions as ReturnType<typeof vi.fn>).mockReturnValue({
      ...noNsPerms,
      canManageNamespace: true,
    });
    render(<MemberDefaultsPanel />);
    expect(screen.getByText('Member defaults')).toBeTruthy();
    expect(screen.getByText('Join open folders')).toBeTruthy();
    expect(screen.getByText('Manage members')).toBeTruthy();
  });
});
