import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchPalette } from '../SearchPalette';
import type { PaletteGroupView } from '../types';

const GROUPS: PaletteGroupView[] = [
  {
    id: 'docs',
    label: 'Documents',
    items: [
      { id: 'd1', kind: 'doc', title: 'Roadmap 2026' },
      { id: 'd2', kind: 'doc', title: 'Q3 launch plan' },
    ],
  },
  {
    id: 'tips',
    label: 'Tips',
    items: [{ id: 't1', kind: 'tip', title: 'Type # to search tags only' }],
  },
  {
    id: 'tags',
    label: 'Tags',
    items: [{ id: 'g1', kind: 'tag', title: '#roadmap', tagColor: '#3b82f6' }],
  },
];

function renderPalette(props: Partial<React.ComponentProps<typeof SearchPalette>> = {}) {
  const onOpen = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    <SearchPalette
      open
      onOpenChange={onOpenChange}
      query="road"
      onQueryChange={vi.fn()}
      scopeLabel="Acme Product"
      groups={GROUPS}
      emptyText="No documents, folders or tags match"
      onOpen={onOpen}
      {...props}
    />
  );
  return { ...utils, onOpen, onOpenChange };
}

function activeName(): string | null {
  return screen.getByRole('option', { selected: true }).textContent;
}

describe('SearchPalette keyboard', () => {
  it('focuses the input when it opens', () => {
    renderPalette();
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'Search' });
    expect(input.matches(':focus')).toBe(true);
    expect([input.selectionStart, input.selectionEnd]).toEqual([4, 4]);
  });

  it('starts on the first item and points the input at it', () => {
    renderPalette();
    const input = screen.getByRole('textbox', { name: 'Search' });
    const active = screen.getByRole('option', { selected: true });
    expect(active.textContent).toContain('Roadmap 2026');
    expect(input.getAttribute('aria-activedescendant')).toBe(active.id);
  });

  it('moves down across groups, skips tips and wraps', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.keyboard('{ArrowDown}');
    expect(activeName()).toContain('Q3 launch plan');
    await user.keyboard('{ArrowDown}');
    expect(activeName()).toContain('#roadmap');
    await user.keyboard('{ArrowDown}');
    expect(activeName()).toContain('Roadmap 2026');
  });

  it('moves up with wrap, and Home and End jump to the ends', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.keyboard('{ArrowUp}');
    expect(activeName()).toContain('#roadmap');
    await user.keyboard('{Home}');
    expect(activeName()).toContain('Roadmap 2026');
    await user.keyboard('{End}');
    expect(activeName()).toContain('#roadmap');
  });

  it('never selects a tip row', () => {
    renderPalette();
    const tip = screen.getByRole('option', { name: /Type # to search tags only/ });
    expect(tip.getAttribute('aria-disabled')).toBe('true');
    expect(tip.getAttribute('aria-selected')).toBe('false');
  });

  it('Enter opens the active item in place', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderPalette();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(onOpen).toHaveBeenCalledWith(GROUPS[0].items[1], { newTab: false });
  });

  it('Ctrl+Enter and Cmd+Enter open in a new tab', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderPalette();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onOpen).toHaveBeenLastCalledWith(GROUPS[0].items[0], { newTab: true });
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenLastCalledWith(GROUPS[0].items[0], { newTab: true });
  });

  it('Enter does nothing when there is nothing to open', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderPalette({ groups: [GROUPS[1]] });
    await user.keyboard('{Enter}');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('keeps the active item when the same query gets new groups', async () => {
    const user = userEvent.setup();
    const { rerender, onOpen, onOpenChange } = renderPalette();
    await user.keyboard('{ArrowDown}');
    const again = (groups: PaletteGroupView[]) =>
      rerender(
        <SearchPalette
          open
          onOpenChange={onOpenChange}
          query="road"
          onQueryChange={vi.fn()}
          scopeLabel="Acme Product"
          groups={groups}
          emptyText="No documents, folders or tags match"
          onOpen={onOpen}
        />
      );
    again([{ ...GROUPS[0], items: [{ id: 'd0', kind: 'doc', title: 'New first' }, ...GROUPS[0].items] }, GROUPS[2]]);
    expect(activeName()).toContain('Q3 launch plan');
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith(GROUPS[0].items[1], { newTab: false });

    again([GROUPS[2]]);
    expect(activeName()).toContain('#roadmap');
  });

  it('resets to the first item when the query changes', async () => {
    const user = userEvent.setup();
    const { rerender, onOpen, onOpenChange } = renderPalette();
    await user.keyboard('{ArrowDown}');
    expect(activeName()).toContain('Q3 launch plan');
    rerender(
      <SearchPalette
        open
        onOpenChange={onOpenChange}
        query="roa"
        onQueryChange={vi.fn()}
        scopeLabel="Acme Product"
        groups={[...GROUPS]}
        emptyText="No documents, folders or tags match"
        onOpen={onOpen}
      />
    );
    expect(activeName()).toContain('Roadmap 2026');
  });

  it('Escape asks to close', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderPalette();
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('reports typing through onQueryChange', async () => {
    const user = userEvent.setup();
    const onQueryChange = vi.fn();
    renderPalette({ query: '', onQueryChange });
    await user.keyboard('r');
    expect(onQueryChange).toHaveBeenCalledWith('r');
  });
});

describe('SearchPalette pointer', () => {
  it('hover makes a row active', async () => {
    const user = userEvent.setup();
    renderPalette();
    await user.hover(screen.getByRole('option', { name: /#roadmap/ }));
    expect(activeName()).toContain('#roadmap');
  });

  it('click opens the row, with the modifier for a new tab', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderPalette();
    await user.click(screen.getByRole('option', { name: /Q3 launch plan/ }));
    expect(onOpen).toHaveBeenLastCalledWith(GROUPS[0].items[1], { newTab: false });
    await user.keyboard('{Control>}');
    await user.click(screen.getByRole('option', { name: /#roadmap/ }));
    expect(onOpen).toHaveBeenLastCalledWith(GROUPS[2].items[0], { newTab: true });
  });

  it('clicking a tip does nothing', async () => {
    const user = userEvent.setup();
    const { onOpen } = renderPalette();
    await user.click(screen.getByRole('option', { name: /Type # to search tags only/ }));
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('SearchPalette content', () => {
  it('shows the empty text for a query with no results', () => {
    renderPalette({ groups: [{ id: 'docs', label: 'Documents', items: [] }] });
    expect(screen.getByText('No documents, folders or tags match')).toBeTruthy();
    expect(screen.queryByText('Documents')).toBeNull();
  });

  it('shows no empty text before anything is typed', () => {
    renderPalette({ query: '  ', groups: [] });
    expect(screen.queryByText('No documents, folders or tags match')).toBeNull();
  });

  it('shows no empty text when there are results', () => {
    renderPalette();
    expect(screen.queryByText('No documents, folders or tags match')).toBeNull();
  });

  it('keeps a group header with an aside while its results stream in', () => {
    renderPalette({
      groups: [{ id: 'text', label: 'In document text', aside: '1 of 5 folders searched', items: [] }],
    });
    expect(screen.getByText('In document text')).toBeTruthy();
    expect(screen.getByText('1 of 5 folders searched')).toBeTruthy();
  });

  it('renders the warning line, the scope and the privacy note', () => {
    renderPalette({ warning: 'Finance is still syncing, so it was not searched yet.' });
    expect(screen.getByText('Finance is still syncing, so it was not searched yet.')).toBeTruthy();
    expect(screen.getByText('Acme Product')).toBeTruthy();
    expect(screen.getByText('Searched on this device only')).toBeTruthy();
  });

  it('highlights the matched part of a title and a snippet', () => {
    renderPalette({
      groups: [
        {
          id: 'text',
          label: 'In document text',
          items: [
            {
              id: 'x',
              kind: 'text',
              title: 'Roadmap 2026',
              titleRanges: [[0, 4]],
              snippet: '…on the road to',
              snippetRanges: [[8, 12]],
            },
          ],
        },
      ],
    });
    const marks = screen.getAllByText('Road', { selector: 'mark' });
    expect(marks).toHaveLength(1);
    expect(screen.getByText('road', { selector: 'mark' })).toBeTruthy();
  });
});
