import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomeEmpty } from '../HomeEmpty';

describe('HomeEmpty', () => {
  it.each([
    ['no-folders', 'No folders yet', 'New folder'],
    ['no-docs', 'No documents yet', 'New document'],
    ['no-matches', 'No documents match these filters', 'Clear filters'],
  ] as const)('%s shows its copy and action', async (kind, heading, action) => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<HomeEmpty kind={kind} onAction={onAction} />);
    expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: action }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('says only part of the documents were read, with nothing to click', () => {
    render(<HomeEmpty kind="partial" onAction={vi.fn()} />);
    expect(
      screen.getByRole('heading', {
        name: 'No matches in the documents read so far',
      }),
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says a tag has no documents yet, with nothing to click', () => {
    render(<HomeEmpty kind="no-tagged" onAction={vi.fn()} />);
    expect(
      screen.getByRole('heading', { name: 'No documents have this tag yet' }),
    ).toBeTruthy();
    expect(
      screen.getByText('Add it from the Tags row at the top of a document.'),
    ).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('hides the action when the caller cannot take it', () => {
    render(<HomeEmpty kind="no-folders" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('takes the caller’s body copy, or none while it is not known yet', () => {
    const { rerender } = render(<HomeEmpty kind="no-docs" body="In here." />);
    expect(screen.getByText('In here.')).toBeTruthy();
    expect(screen.queryByText(/in every folder/)).toBeNull();
    rerender(<HomeEmpty kind="no-docs" body={null} />);
    expect(screen.queryByText('In here.')).toBeNull();
    expect(screen.queryByText(/in every folder/)).toBeNull();
  });
});
