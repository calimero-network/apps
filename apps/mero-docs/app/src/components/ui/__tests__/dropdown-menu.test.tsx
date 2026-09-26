import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../dropdown-menu';

describe('DropdownMenuContent focus on close', () => {
  it('returns focus to the trigger on a plain close', async () => {
    const user = userEvent.setup();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Plain</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    await user.click(screen.getByRole('button', { name: 'Open' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Plain' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    // Enter reaches the trigger only if it has focus back, and reopens the menu.
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('menu')).toBeTruthy();
  });
});
