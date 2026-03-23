import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FolderTree } from './FolderTree';
import type { FolderTreeItem } from '@/api/AbiClient';
import type { FolderAccessInfo } from '@/utils/folderAccess';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@calimero-network/calimero-client', () => ({
  useCalimero: () => ({ app: {}, isAuthenticated: true }),
}));

vi.mock('@/context/WorkspaceContext', () => ({
  useWorkspace: () => ({
    activeGroupId: 'g1',
    activeContextId: 'general-1',
    generalContextId: 'general-1',
    setActiveContext: vi.fn(),
    setActiveWorkspace: vi.fn(),
  }),
}));

vi.mock('@/api/FolderContextManager', () => ({
  FolderContextManager: class {
    setFolderVisibility = vi.fn().mockResolvedValue(undefined);
  },
}));

const mocks = vi.hoisted(() => ({
  passThrough: (props: any) => props.children ?? null,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: mocks.passThrough,
  DropdownMenuTrigger: mocks.passThrough,
  DropdownMenuContent: mocks.passThrough,
  DropdownMenuItem: mocks.passThrough,
  DropdownMenuSeparator: () => null,
}));

function makeFolder(overrides: Partial<FolderAccessInfo> = {}): FolderAccessInfo {
  return {
    context_id: 'ctx-f1',
    name: 'Folder',
    color: null,
    created_at: 0,
    visibility: 'open',
    accessLevel: 'open_joinable',
    isCreator: false,
    isAllowlisted: false,
    canJoin: true,
    ...overrides,
  };
}

function baseProps(overrides: Record<string, any> = {}) {
  return {
    folders: [],
    documents: [],
    selectedFolderId: null,
    onSelectFolder: vi.fn(),
    onCreateFolder: vi.fn(),
    onRenameFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
    onOpenDocument: vi.fn(),
    onCreateDocument: vi.fn(),
    expandedFolders: new Set<string>(),
    onToggleFolder: vi.fn(),
    topLevelFolders: [] as FolderAccessInfo[],
    activeContextId: 'general-1',
    generalContextId: 'general-1',
    onTopLevelFolderSelect: vi.fn(),
    onCreateTopLevelFolder: vi.fn(),
    onTopLevelFolderSettings: vi.fn(),
    onTopLevelFolderVisibilityChanged: vi.fn(),
    canCreateContext: true,
    ...overrides,
  };
}

describe('FolderTree', () => {
  describe('General folder rendering', () => {
    it('renders General entry when generalContextId is set', () => {
      render(<FolderTree {...baseProps()} />);
      expect(screen.getByText('General')).toBeTruthy();
    });

    it('applies active highlight when General is the active context', () => {
      render(<FolderTree {...baseProps({ activeContextId: 'general-1' })} />);
      const el = screen.getByTestId('folder-context-general');
      expect(el?.className).toMatch(/bg-primary/);
    });

    it('calls onTopLevelFolderSelect with generalContextId when clicked', async () => {
      const user = userEvent.setup();
      const props = baseProps();
      render(<FolderTree {...props} />);
      await user.click(screen.getByText('General'));
      expect(props.onTopLevelFolderSelect).toHaveBeenCalledWith('general-1');
    });
  });

  describe('"New" button gating', () => {
    it('shows New button when canCreateContext is true', () => {
      render(<FolderTree {...baseProps({ canCreateContext: true })} />);
      expect(screen.getByText('New')).toBeTruthy();
    });

    it('hides New button when canCreateContext is false', () => {
      render(<FolderTree {...baseProps({ canCreateContext: false })} />);
      expect(screen.queryByText('New')).toBeNull();
    });

    it('calls onCreateTopLevelFolder when New is clicked', async () => {
      const user = userEvent.setup();
      const props = baseProps();
      render(<FolderTree {...props} />);
      await user.click(screen.getByText('New'));
      expect(props.onCreateTopLevelFolder).toHaveBeenCalled();
    });
  });

  describe('open vs restricted folder rendering', () => {
    it('renders an open joinable folder by name', () => {
      const folder = makeFolder({ name: 'Work Files', visibility: 'open', canJoin: true });
      render(<FolderTree {...baseProps({ topLevelFolders: [folder] })} />);
      expect(screen.getByText('Work Files')).toBeTruthy();
    });

    it('renders a restricted blocked folder by name', () => {
      const folder = makeFolder({
        name: 'Secret Docs',
        visibility: 'restricted',
        accessLevel: 'restricted_blocked',
        canJoin: false,
      });
      render(<FolderTree {...baseProps({ topLevelFolders: [folder] })} />);
      expect(screen.getByText('Secret Docs')).toBeTruthy();
    });

    it('applies cursor-not-allowed and opacity-60 to non-joinable folders', () => {
      const folder = makeFolder({
        name: 'Blocked',
        visibility: 'restricted',
        accessLevel: 'restricted_blocked',
        canJoin: false,
      });
      render(<FolderTree {...baseProps({ topLevelFolders: [folder] })} />);
      const row = screen.getByTestId('top-level-folder-ctx-f1');
      expect(row?.className).toMatch(/cursor-not-allowed/);
      expect(row?.className).toMatch(/opacity-60/);
    });

    it('applies cursor-pointer to joinable folders', () => {
      const folder = makeFolder({ name: 'Open Stuff', visibility: 'open', canJoin: true });
      render(<FolderTree {...baseProps({ topLevelFolders: [folder] })} />);
      const row = screen.getByTestId('top-level-folder-ctx-f1');
      expect(row?.className).toMatch(/cursor-pointer/);
    });
  });

  describe('folder selection behavior', () => {
    it('calls onTopLevelFolderSelect for joinable folders', async () => {
      const user = userEvent.setup();
      const folder = makeFolder({ context_id: 'ctx-open', name: 'Team Notes', canJoin: true });
      const props = baseProps({ topLevelFolders: [folder] });
      render(<FolderTree {...props} />);
      await user.click(screen.getByText('Team Notes'));
      expect(props.onTopLevelFolderSelect).toHaveBeenCalledWith('ctx-open');
    });

    it('does NOT call onTopLevelFolderSelect for non-joinable folders', async () => {
      const user = userEvent.setup();
      const folder = makeFolder({
        context_id: 'ctx-blocked',
        name: 'Blocked Folder',
        canJoin: false,
        visibility: 'restricted',
      });
      const props = baseProps({ topLevelFolders: [folder] });
      render(<FolderTree {...props} />);
      await user.click(screen.getByText('Blocked Folder'));
      expect(props.onTopLevelFolderSelect).not.toHaveBeenCalled();
    });
  });

  describe('empty state', () => {
    it('shows "No folders available" when generalContextId is null and no top-level folders', () => {
      render(<FolderTree {...baseProps({ generalContextId: null, topLevelFolders: [] })} />);
      expect(screen.getByText('No folders available')).toBeTruthy();
    });
  });

  describe('rename/delete menu gating (canCreateContext)', () => {
    it('hides Rename / Delete for top-level folder when canCreateContext is false', () => {
      const folder = makeFolder({ name: 'TL Folder', context_id: 'ctx-tl' });
      render(
        <FolderTree
          {...baseProps({
            topLevelFolders: [folder],
            activeContextId: 'ctx-tl',
            canCreateContext: false,
          })}
        />,
      );
      expect(
        screen.queryAllByText((content) => content.includes('Rename / Delete')).length,
      ).toBe(0);
    });

    it('shows Rename / Delete for top-level folder when canCreateContext is true', () => {
      const folder = makeFolder({ name: 'TL Folder', context_id: 'ctx-tl' });
      render(
        <FolderTree
          {...baseProps({
            topLevelFolders: [folder],
            activeContextId: 'ctx-tl',
            canCreateContext: true,
          })}
        />,
      );
      expect(
        screen.queryAllByText((content) => content.includes('Rename / Delete')).length,
      ).toBeGreaterThan(0);
    });

    it('hides Rename and Delete on subfolder rows when canCreateContext is false', () => {
      const nestedFolders: FolderTreeItem[] = [
        {
          id: 'parent-1',
          name: 'Parent',
          parent_id: null,
          color: null,
          document_count: 0,
          children: [
            {
              id: 'child-1',
              name: 'Child',
              parent_id: 'parent-1',
              color: null,
              document_count: 0,
              children: [],
            },
          ],
        },
      ];
      render(
        <FolderTree
          {...baseProps({
            folders: nestedFolders,
            expandedFolders: new Set(['parent-1']),
            canCreateContext: false,
          })}
        />,
      );
      expect(screen.queryByText('Rename')).toBeNull();
      expect(screen.queryByText('Delete')).toBeNull();
      expect(screen.getByText('Parent')).toBeTruthy();
      expect(screen.getByText('Child')).toBeTruthy();
    });
  });
});
