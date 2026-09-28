import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterChecklist } from '../FilterChecklist';

const items = [
  {
    id: 'design',
    label: 'design',
    dotColor: '#8b5cf6',
    count: 3,
    checked: true,
  },
  { id: 'roadmap', label: 'Roadmap', count: 2, checked: false },
  { id: 'q3', label: 'q3', count: 2, checked: false },
];

function setup(onToggle = vi.fn(), onClear = vi.fn()) {
  render(
    <FilterChecklist
      placeholder="Filter tags"
      items={items}
      onToggle={onToggle}
      onClear={onClear}
      footerHint="Match any selected tag"
    />,
  );
  return { onToggle, onClear };
}

describe('FilterChecklist', () => {
  it('renders every item with its checked state, count and the footer', () => {
    setup();
    expect(
      screen
        .getByRole('checkbox', { name: /design/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen
        .getByRole('checkbox', { name: /Roadmap/ })
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByText('Match any selected tag')).toBeTruthy();
  });

  it('filters by name, ignoring case, and says when nothing matches', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(
      screen.getByRole('textbox', { name: 'Filter tags' }),
      'ROAD',
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    await user.type(
      screen.getByRole('textbox', { name: 'Filter tags' }),
      'zzz',
    );
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('matches words in any order, and typos only when nothing matches exactly', async () => {
    const user = userEvent.setup();
    render(
      <FilterChecklist
        placeholder="Filter tags"
        items={[
          { id: 'q3', label: 'Q3 roadmap', count: 1, checked: false },
          { id: 'read', label: 'read later', count: 1, checked: false },
        ]}
        onToggle={vi.fn()}
        onClear={vi.fn()}
        footerHint=""
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Filter tags' });
    const shown = () =>
      screen.queryAllByRole('checkbox').map((c) => c.textContent);
    await user.type(field, 'roadmap q3');
    expect(shown()).toEqual([expect.stringMatching(/^Q3 roadmap/)]);
    await user.clear(field);
    await user.type(field, 'road');
    expect(shown()).toEqual([expect.stringMatching(/^Q3 roadmap/)]);
    await user.clear(field);
    await user.type(field, 'raed');
    expect(shown()).toEqual([expect.stringMatching(/^read later/)]);
  });

  it('toggles an item on click', async () => {
    const user = userEvent.setup();
    const { onToggle } = setup();
    await user.click(screen.getByRole('checkbox', { name: /q3/ }));
    expect(onToggle).toHaveBeenCalledWith('q3');
  });

  // What the keys act on proves where focus went.
  it('moves with the arrow keys from the field and toggles with Space', async () => {
    const user = userEvent.setup();
    const { onToggle } = setup();
    await user.click(screen.getByRole('textbox', { name: 'Filter tags' }));
    await user.keyboard('{ArrowDown}{ArrowDown} ');
    expect(onToggle).toHaveBeenCalledWith('roadmap');
    await user.keyboard('{ArrowUp}{ArrowUp}q');
    expect(
      (screen.getByRole('textbox', { name: 'Filter tags' }) as HTMLInputElement)
        .value,
    ).toBe('q');
  });

  it('clears from the footer', async () => {
    const user = userEvent.setup();
    const { onClear } = setup();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
