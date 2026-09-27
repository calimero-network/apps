import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from '../FilterBar';
import type { FilterChipView } from '../types';

function chip(over: Partial<FilterChipView>): FilterChipView {
  return { id: 'tag', icon: 'tag', label: 'Tag', active: false, ...over };
}

describe('FilterBar', () => {
  it('opens a chip popover on click', async () => {
    const user = userEvent.setup();
    render(
      <FilterBar
        chips={[chip({ popover: <p>Tag list</p> })]}
        sortLabel="Last updated"
        onSortClick={() => {}}
        onClear={() => {}}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Tag' }));
    expect(await screen.findByText('Tag list')).toBeTruthy();
  });

  it('clears an active chip from its X, and offers Clear for all', async () => {
    const user = userEvent.setup();
    const onClearChip = vi.fn();
    const onClear = vi.fn();
    render(
      <FilterBar
        chips={[
          chip({
            label: 'Tag: design',
            active: true,
            onClear: onClearChip,
            popover: <p>Tag list</p>,
          }),
        ]}
        sortLabel="Last updated"
        onSortClick={() => {}}
        onClear={onClear}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Clear Tag: design' }));
    expect(onClearChip).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Tag list')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('hides Clear when no chip is active', () => {
    render(
      <FilterBar
        chips={[chip({})]}
        sortLabel="Last updated"
        onSortClick={() => {}}
        onClear={() => {}}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
  });

  it('flips a toggle chip on click and reports its state', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { rerender } = render(
      <FilterBar
        chips={[
          chip({
            id: 'archived',
            icon: 'archive',
            label: 'Archived',
            toggle: true,
            onToggle,
          }),
        ]}
        sortLabel="Last updated"
        onSortClick={() => {}}
        onClear={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name: 'Archived' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    await user.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(
      <FilterBar
        chips={[
          chip({
            id: 'archived',
            icon: 'archive',
            label: 'Archived',
            toggle: true,
            onToggle,
            active: true,
          }),
        ]}
        sortLabel="Last updated"
        onSortClick={() => {}}
        onClear={() => {}}
      />,
    );
    expect(
      screen
        .getByRole('button', { name: 'Archived' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('calls onSortClick from the sort button', async () => {
    const user = userEvent.setup();
    const onSortClick = vi.fn();
    render(
      <FilterBar
        chips={[]}
        sortLabel="Last updated"
        onSortClick={onSortClick}
        onClear={() => {}}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Sort: Last updated' }),
    );
    expect(onSortClick).toHaveBeenCalledTimes(1);
  });
});
