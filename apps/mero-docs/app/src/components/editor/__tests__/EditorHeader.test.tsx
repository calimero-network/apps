import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorHeader } from '../EditorHeader';

describe('EditorHeader back button', () => {
  it('names the folder it goes back to', () => {
    const onBack = vi.fn();
    render(
      <EditorHeader documentName="Plan" folderName="Budget" onBack={onBack} />,
    );
    const back = screen.getByRole('button', { name: 'Back to Budget' });
    expect(back.textContent).toContain('Budget');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('falls back to a plain Back while the folder name is unknown', () => {
    render(<EditorHeader documentName="Plan" onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
  });
});

describe('EditorHeader copy link', () => {
  it('copies from a labelled button', () => {
    const onCopyLink = vi.fn();
    render(<EditorHeader documentName="Plan" onCopyLink={onCopyLink} />);
    const button = screen.getByRole('button', { name: 'Copy link' });
    expect(button.textContent).toContain('Copy link');
    fireEvent.click(button);
    expect(onCopyLink).toHaveBeenCalledTimes(1);
  });

  it('is absent without a link to copy', () => {
    render(<EditorHeader documentName="Plan" />);
    expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
  });
});

describe('EditorHeader details toggle', () => {
  it('toggles Details and says whether it is open', () => {
    const onToggleDetails = vi.fn();
    const { rerender } = render(
      <EditorHeader
        documentName="Plan"
        detailsOpen={false}
        onToggleDetails={onToggleDetails}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Details' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(onToggleDetails).toHaveBeenCalledTimes(1);
    rerender(
      <EditorHeader
        documentName="Plan"
        detailsOpen
        onToggleDetails={onToggleDetails}
      />,
    );
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('EditorHeader archive', () => {
  it('offers Archive to an editor of a live document', async () => {
    const user = userEvent.setup();
    const onArchive = vi.fn();
    render(
      <EditorHeader documentName="Plan" onDelete={vi.fn()} onArchive={onArchive} />,
    );
    await user.click(screen.getByRole('button', { name: 'Document actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Unarchive' })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: 'Archive' }));
    expect(onArchive).toHaveBeenCalledTimes(1);
  });

  it('offers Unarchive on an archived document', async () => {
    const user = userEvent.setup();
    const onUnarchive = vi.fn();
    render(<EditorHeader documentName="Plan" onUnarchive={onUnarchive} />);
    await user.click(screen.getByRole('button', { name: 'Document actions' }));
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull();
    await user.click(await screen.findByRole('menuitem', { name: 'Unarchive' }));
    expect(onUnarchive).toHaveBeenCalledTimes(1);
  });

  it('offers neither without the right to change the document', async () => {
    const user = userEvent.setup();
    render(<EditorHeader documentName="Plan" onDelete={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Document actions' }));
    await screen.findByRole('menuitem', { name: 'Delete document' });
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Unarchive' })).toBeNull();
  });
});
