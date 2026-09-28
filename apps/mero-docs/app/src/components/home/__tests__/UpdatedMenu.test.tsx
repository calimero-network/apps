import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpdatedMenu } from '../UpdatedMenu';

describe('UpdatedMenu', () => {
  it('checks the current window', () => {
    render(<UpdatedMenu value="7d" onChange={() => {}} />);
    expect(
      screen
        .getByRole('radio', { name: 'Last 7 days' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen
        .getByRole('radio', { name: 'Any time' })
        .getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('checks Any time when no window is set', () => {
    render(<UpdatedMenu value={undefined} onChange={() => {}} />);
    expect(
      screen
        .getByRole('radio', { name: 'Any time' })
        .getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('reports the picked window, and undefined for Any time', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<UpdatedMenu value="7d" onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Today' }));
    expect(onChange).toHaveBeenLastCalledWith('1d');
    await user.click(screen.getByRole('radio', { name: 'Any time' }));
    expect(onChange).toHaveBeenLastCalledWith(undefined);
  });

  // What Enter picks proves where focus went.
  it('moves between options with the arrow keys', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<UpdatedMenu value="7d" onChange={onChange} />);
    screen.getByRole('radio', { name: 'Last 7 days' }).focus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('30d');
    await user.keyboard('{ArrowUp}{ArrowUp}{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('1d');
  });
});
