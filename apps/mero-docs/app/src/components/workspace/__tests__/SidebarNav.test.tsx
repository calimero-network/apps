import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarNav } from '../SidebarNav';

type NavProps = React.ComponentProps<typeof SidebarNav>;

const tag = (name: string, count: number, selected = false) => ({
  key: name,
  name,
  color: '#8b5cf6',
  count,
  selected,
  onSelect: vi.fn(),
});

function setup(over: Partial<NavProps> = {}) {
  const props: NavProps = {
    home: { count: 10, selected: true, onSelect: vi.fn() },
    views: [
      {
        id: 'v1',
        name: 'Design this week',
        count: 3,
        shared: false,
        selected: false,
        onSelect: vi.fn(),
      },
      {
        id: 'v2',
        name: 'Q3 launch',
        count: 2,
        shared: true,
        selected: false,
        onSelect: vi.fn(),
      },
    ],
    tags: [
      tag('design', 3),
      tag('roadmap', 2),
      tag('q3', 2),
      tag('api', 1),
      tag('launch', 1),
      tag('brand', 1),
      tag('ops', 1),
    ],
    onAddView: vi.fn(),
    onAddTag: vi.fn(),
    canManage: true,
    ...over,
  };
  render(<SidebarNav {...props} />);
  return { props, user: userEvent.setup() };
}

describe('SidebarNav', () => {
  it('renders Home with its count and marks the selected row', async () => {
    const { props, user } = setup();
    const home = screen.getByRole('button', { name: /Home/ });
    expect(home.getAttribute('aria-current')).toBe('page');
    expect(home.textContent).toContain('10');
    await user.click(home);
    expect(props.home.onSelect).toHaveBeenCalledTimes(1);
  });

  it('lists views and selects one', async () => {
    const { props, user } = setup();
    const views = screen.getByRole('region', { name: 'Views' });
    await user.click(within(views).getByRole('button', { name: /Q3 launch/ }));
    expect(props.views[1].onSelect).toHaveBeenCalledTimes(1);
    expect(within(views).getByLabelText('Shared with everyone')).toBeTruthy();
  });

  it('shows the top five tags and toggles the rest', async () => {
    const { props, user } = setup();
    const tags = screen.getByRole('region', { name: 'Tags' });
    expect(within(tags).queryByRole('button', { name: /brand/ })).toBeNull();
    await user.click(
      within(tags).getByRole('button', { name: 'Show all 7 tags' }),
    );
    await user.click(within(tags).getByRole('button', { name: /ops/ }));
    expect(props.tags[6].onSelect).toHaveBeenCalledTimes(1);
    await user.click(within(tags).getByRole('button', { name: 'Show fewer' }));
    expect(within(tags).queryByRole('button', { name: /ops/ })).toBeNull();
  });

  it('keeps a selected tag beyond the top five visible', () => {
    setup({
      tags: [
        tag('a', 5),
        tag('b', 4),
        tag('c', 3),
        tag('d', 2),
        tag('e', 1),
        tag('f', 1, true),
      ],
    });
    expect(
      screen.getByRole('button', { name: /f/, current: 'page' }),
    ).toBeTruthy();
  });

  it('has no show-all toggle for five tags or fewer', () => {
    setup({ tags: [tag('design', 3)] });
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull();
  });

  it('adds from the section headers when the viewer can manage', async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole('button', { name: 'New view' }));
    await user.click(screen.getByRole('button', { name: 'New tag' }));
    expect(props.onAddView).toHaveBeenCalledTimes(1);
    expect(props.onAddTag).toHaveBeenCalledTimes(1);
  });

  it('hides the add buttons when the viewer cannot manage', () => {
    setup({ canManage: false });
    expect(screen.queryByRole('button', { name: 'New view' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New tag' })).toBeNull();
  });

  it('shows hints for empty views and tags', () => {
    setup({ views: [], tags: [] });
    expect(
      screen.getByText('Save a filtered list to pin it here'),
    ).toBeTruthy();
    expect(
      screen.getByText('Tags you add to documents show here'),
    ).toBeTruthy();
  });

  it('truncates long names', () => {
    setup({
      views: [
        {
          id: 'v',
          name: 'A very long view name '.repeat(10),
          count: 1,
          shared: false,
          selected: false,
          onSelect: () => {},
        },
      ],
    });
    expect(screen.getByText(/A very long view name/).className).toContain(
      'truncate',
    );
  });
});
