import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FolderInfoPanel } from '../FolderInfoPanel';

// Embedded children reach into data hooks; stub them to inert shells so
// the panel's own structure + close behavior is what we assert.
vi.mock('../FolderSharingPanel', () => ({
  FolderSharingPanel: ({ folderId }: { folderId: string }) => (
    <div data-testid="sharing">{folderId}</div>
  ),
}));
vi.mock('../FolderVisibilityToggle', () => ({
  FolderVisibilityToggle: () => <button>visibility</button>,
}));

function renderPanel() {
  const onClose = vi.fn();
  render(
    <FolderInfoPanel
      folderId="f1"
      folderAlias="Design"
      currentVisibility="Open"
      onClose={onClose}
    />,
  );
  return { onClose, user: userEvent.setup() };
}

describe('FolderInfoPanel', () => {
  it('names the dialog after the folder, embeds sharing, and closes from its button', async () => {
    const { onClose, user } = renderPanel();
    expect(screen.getByRole('dialog', { name: 'Design' })).toBeTruthy();
    expect(screen.getByTestId('sharing').textContent).toBe('f1');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when the inner card is clicked', async () => {
    const { onClose, user } = renderPanel();
    await user.click(screen.getByText('Design'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const { onClose, user } = renderPanel();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
