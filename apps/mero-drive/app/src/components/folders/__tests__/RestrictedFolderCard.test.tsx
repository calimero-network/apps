import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RestrictedFolderCard } from '../RestrictedFolderCard';

// Regression layer for the Open-folder join flow. The card drives a
// TWO-context join (verified against core): `joinSubgroupInheritance`
// is subgroup-scoped — key + namespace op — while `joinContext` writes
// the node's owned ContextIdentity for the docs context. Miss either
// and `execute`/`list_docs` fails with "No owned identity found for
// this context". The mocks below let each branch + failure mode be
// asserted in isolation, without a live node.
const joinSubgroupInheritance = vi.fn();
const joinContext = vi.fn();
const getFolderContext = vi.fn();

vi.mock('@calimero-network/mero-react', () => ({
  useJoinSubgroupInheritance: () => ({
    joinSubgroupInheritance,
    loading: false,
    error: null,
  }),
  useJoinContext: () => ({ joinContext, loading: false, error: null }),
}));

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ registryClient: { getFolderContext } }),
}));

const baseProps = {
  folderId: 'folder-1',
  folderAlias: 'WWWOOWWW',
  selfIdentity: 'me',
} as const;

describe('RestrictedFolderCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    joinSubgroupInheritance.mockResolvedValue({});
    getFolderContext.mockResolvedValue('docs-ctx-xyz');
    joinContext.mockResolvedValue({});
  });

  describe('Open folder — join flow', () => {
    it('joins the subgroup then the docs context, in that order', async () => {
      render(<RestrictedFolderCard {...baseProps} visibility="Open" />);
      fireEvent.click(screen.getByRole('button', { name: /join folder/i }));

      await waitFor(() =>
        expect(joinContext).toHaveBeenCalledWith('docs-ctx-xyz'),
      );
      expect(joinSubgroupInheritance).toHaveBeenCalledWith('folder-1');
      expect(getFolderContext).toHaveBeenCalledWith({ folder_id: 'folder-1' });
      // Subgroup join must precede the context join — the docs context
      // join is authorised via the (just-materialised) membership.
      expect(
        joinSubgroupInheritance.mock.invocationCallOrder[0],
      ).toBeLessThan(joinContext.mock.invocationCallOrder[0]);
    });

    it('refetches workspace + per-folder permissions after a successful join', async () => {
      const refetch = vi.fn();
      const refetchPerms = vi.fn();
      render(
        <RestrictedFolderCard
          {...baseProps}
          visibility="Open"
          refetch={refetch}
          refetchPerms={refetchPerms}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /join folder/i }));

      await waitFor(() => expect(refetch).toHaveBeenCalled());
      expect(refetchPerms).toHaveBeenCalled();
    });

    it('does NOT join the docs context if the subgroup join fails', async () => {
      joinSubgroupInheritance.mockRejectedValue(new Error('subgroup boom'));
      render(<RestrictedFolderCard {...baseProps} visibility="Open" />);
      fireEvent.click(screen.getByRole('button', { name: /join folder/i }));

      // Failure surfaces as an alert, and the context join never runs.
      expect(await screen.findByRole('alert')).toBeTruthy();
      expect(joinContext).not.toHaveBeenCalled();
    });

    it('surfaces an error if the docs-context join fails', async () => {
      joinContext.mockRejectedValue(new Error('context join boom'));
      const refetch = vi.fn();
      render(
        <RestrictedFolderCard
          {...baseProps}
          visibility="Open"
          refetch={refetch}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /join folder/i }));

      expect(await screen.findByRole('alert')).toBeTruthy();
      // The join did not complete — no workspace refetch.
      expect(refetch).not.toHaveBeenCalled();
    });
  });

  describe('visibility branches', () => {
    it('Restricted → shows the ask-admin copy, no Join CTA', () => {
      render(<RestrictedFolderCard {...baseProps} visibility="Restricted" />);
      expect(screen.getByText(/this folder is restricted/i)).toBeTruthy();
      expect(
        screen.queryByRole('button', { name: /join folder/i }),
      ).toBeNull();
      // The caller's identity is offered for the admin to add.
      expect(screen.getByDisplayValue('me')).toBeTruthy();
    });

    it('undefined visibility (syncing) → "Try joining", same join action', async () => {
      render(<RestrictedFolderCard {...baseProps} visibility={undefined} />);
      fireEvent.click(screen.getByRole('button', { name: /try joining/i }));
      await waitFor(() =>
        expect(joinContext).toHaveBeenCalledWith('docs-ctx-xyz'),
      );
    });
  });
});
