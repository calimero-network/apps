import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// vi.mock is hoisted above imports, so this resolves to the mocked
// dependencies declared below.
import { NewFolderDialog } from '../NewFolderDialog';

const create = vi.fn().mockResolvedValue({ groupId: 'new-folder', failedMembers: [] });
const toastError = vi.hoisted(() => vi.fn());

vi.mock('@/hooks/useFolderOperations', () => ({
  useFolderOperations: () => ({ create, rename: vi.fn(), remove: vi.fn() }),
}));

vi.mock('sonner', () => ({
  toast: { error: toastError },
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
    namespaceMemberNames: { 'member-a': 'Alice', 'member-b': 'Bob' },
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

  it('toasts the display names of members that failed to be added', async () => {
    create.mockResolvedValueOnce({
      groupId: 'new-folder',
      failedMembers: ['member-a', 'member-b'],
    });
    const onClose = vi.fn();
    render(<NewFolderDialog parentFolderId={null} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Restricted/ }));
    fireEvent.change(screen.getByPlaceholderText('Folder name'), {
      target: { value: 'Secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith(
      "Some members weren't added",
      expect.objectContaining({ description: expect.stringContaining('Alice, Bob') }),
    );
  });

  it('does not toast when every member is added cleanly', async () => {
    create.mockResolvedValueOnce({ groupId: 'new-folder', failedMembers: [] });
    const onClose = vi.fn();
    render(<NewFolderDialog parentFolderId={null} onClose={onClose} />);
    fireEvent.change(screen.getByPlaceholderText('Folder name'), {
      target: { value: 'Public' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('NewFolderDialog closing', () => {
  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<NewFolderDialog parentFolderId={null} onClose={onClose} />);
    await userEvent.setup().keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores Escape while the folder is being created', async () => {
    create.mockReturnValueOnce(new Promise(() => {}));
    const onClose = vi.fn();
    render(<NewFolderDialog parentFolderId={null} onClose={onClose} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Folder name'), 'Slow');
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByRole('button', { name: 'Creating…' });
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'New folder' })).toBeTruthy();
  });
});
