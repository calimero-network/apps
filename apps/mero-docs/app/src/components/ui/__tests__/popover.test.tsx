import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popover, PopoverTrigger, PopoverContent } from '../popover';

function Harness() {
  return (
    <Popover>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverContent>Popover content</PopoverContent>
    </Popover>
  );
}

describe('PopoverContent', () => {
  it('opens on trigger click and closes on Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);
    expect(await screen.findByText('Popover content')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Popover content')).toBeNull();
  });

  // Enter reaching the trigger proves focus returned to it, not somewhere else.
  it('returns focus to the trigger after Escape', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Open' });
    await user.click(trigger);
    await screen.findByText('Popover content');
    await user.keyboard('{Escape}');
    expect(screen.queryByText('Popover content')).toBeNull();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Popover content')).toBeTruthy();
  });
});
