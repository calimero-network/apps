import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SectionBanner } from '../SectionBanner';

describe('SectionBanner', () => {
  it('names the section it opened, with Go to top and dismiss', async () => {
    const user = userEvent.setup();
    const onTop = vi.fn();
    const onDismiss = vi.fn();
    render(
      <SectionBanner
        variant="opened"
        section="Milestones"
        onTop={onTop}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Opened from a link to Milestones',
    );
    await user.click(screen.getByRole('button', { name: 'Go to top' }));
    expect(onTop).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('says a removed section left you at the top, with dismiss only', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<SectionBanner variant="missing" onDismiss={onDismiss} />);
    expect(screen.getByRole('status').textContent).toBe(
      'That section was removed, so you are at the top of the document',
    );
    expect(screen.queryByRole('button', { name: 'Go to top' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
