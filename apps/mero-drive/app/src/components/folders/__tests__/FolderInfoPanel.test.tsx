import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('FolderInfoPanel', () => {
  it('renders the alias, embeds sharing, and closes on backdrop click', () => {
    const onClose = vi.fn();
    render(
      <FolderInfoPanel
        folderId="f1"
        folderAlias="Design"
        currentVisibility="Open"
        onClose={onClose}
      />,
    );
    expect(screen.getByText('Design')).toBeTruthy();
    expect(screen.getByTestId('sharing').textContent).toBe('f1');
    // backdrop is the dialog root; clicking it closes
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when the inner card is clicked', () => {
    const onClose = vi.fn();
    render(
      <FolderInfoPanel
        folderId="f1"
        folderAlias="Design"
        currentVisibility="Open"
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText('Design'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <FolderInfoPanel folderId="f1" folderAlias="Design" currentVisibility="Open" onClose={onClose} />,
    );
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
