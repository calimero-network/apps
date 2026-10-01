import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InviteDialog } from '../InviteDialog';

describe('InviteDialog retry after a failed generate', () => {
  it('keeps the generate button visible as "Try again", and a retry can succeed', async () => {
    const onCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error('Node offline'))
      .mockResolvedValueOnce({ url: 'https://example.com/join?x=1' });
    const user = userEvent.setup();
    render(
      <InviteDialog
        title="Invite to workspace"
        description="Share this link."
        onCreate={onCreate}
        onClose={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: /generate invite link/i }),
    );
    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /^close$/i })).toBeTruthy();

    const retry = screen.getByRole('button', { name: /try again/i });
    await user.click(retry);

    await screen.findByDisplayValue('https://example.com/join?x=1');
    expect(onCreate).toHaveBeenCalledTimes(2);
  });
});
