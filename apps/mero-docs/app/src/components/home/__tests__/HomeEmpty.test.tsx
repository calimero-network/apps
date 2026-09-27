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

  it('hides the action when the caller cannot take it', () => {
    render(<HomeEmpty kind="no-folders" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
