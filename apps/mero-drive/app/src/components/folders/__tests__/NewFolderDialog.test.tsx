import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// vi.mock is hoisted above imports, so this resolves to the mocked
// dependencies declared below.
import { NewFolderDialog } from '../NewFolderDialog';

const create = vi.fn().mockResolvedValue('new-folder');

vi.mock('@/hooks/useFolderOperations', () => ({
  useFolderOperations: () => ({ create, rename: vi.fn(), remove: vi.fn() }),
}));

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns-1',
    rootGroupId: 'root-group',
    folders: [],
    registryClient: {},
    applicationId: 'app-1',
    refetch: vi.fn(),
    selfIdentity: 'me',
  }),
}));

// Stub the picker so the test can drive onSelect without the SDK.
vi.mock('@/components/common/MemberPicker', () => ({
  MemberPicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect('member-a')}>
      add-member-a
    </button>
  ),
}));

// Stub the label so the selected-member chip doesn't pull in
// useMemberDisplayName / the SDK; rendering the id is enough here.
vi.mock('@/components/common/MemberLabel', () => ({
  MemberLabel: ({ memberId }: { memberId: string }) => <span>{memberId}</span>,
}));

beforeEach(() => vi.clearAllMocks());

describe('NewFolderDialog member-picker', () => {
  it('hides the member-picker for Open folders', () => {
    render(<NewFolderDialog parentFolderId={null} onClose={vi.fn()} />);
    expect(screen.queryByText('add-member-a')).toBeNull();
  });

  it('shows the picker for Restricted and passes selected members to create', async () => {
    render(<NewFolderDialog parentFolderId={null} onClose={vi.fn()} />);
    // The visibility toggle button's accessible name includes its
    // description ("Restricted Invite members manually"), so match by
    // substring.
    fireEvent.click(screen.getByRole('button', { name: /Restricted/ }));
    fireEvent.click(screen.getByText('add-member-a')); // picker fires onSelect
    fireEvent.change(screen.getByPlaceholderText('Folder name'), {
      target: { value: 'Secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          alias: 'Secret',
          visibility: 'Restricted',
          members: ['member-a'],
        }),
      ),
    );
  });

  it('sends no members when visibility stays Open', async () => {
    render(<NewFolderDialog parentFolderId={null} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Folder name'), {
      target: { value: 'Public' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'Open', members: [] }),
      ),
    );
  });
});
