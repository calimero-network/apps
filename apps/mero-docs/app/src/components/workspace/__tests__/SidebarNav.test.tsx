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
    mentions: { count: 1, selected: false, onSelect: vi.fn() },
    views: [
      {
        id: 'v1',
        name: 'Design this week',
        count: 3,
        shared: false,
        selected: false,
        onSelect: vi.fn(),
        onRename: vi.fn(),
        onCopyLink: vi.fn(),
        onDelete: vi.fn(),
        canManage: true,
      },
      {
        id: 'v2',
        name: 'Q3 launch',
        count: 2,
        shared: true,
        selected: false,
        onSelect: vi.fn(),
        onRename: vi.fn(),
        onCopyLink: vi.fn(),
        onDelete: vi.fn(),
        canManage: true,
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
    collapsed: { views: false, tags: false },
    onToggleSection: vi.fn(),
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
    await user.click(
      within(views).getByRole('button', {
        name: 'Q3 launch, shared with everyone, 2',
      }),
    );
    expect(props.views[1].onSelect).toHaveBeenCalledTimes(1);
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
          onRename: () => {},
          onCopyLink: () => {},
          onDelete: () => {},
          canManage: true,
        },
      ],
    });
    expect(screen.getByText(/A very long view name/).className).toContain(
      'truncate',
    );
  });

  it('toggles a section from its header, by mouse and keyboard', async () => {
    const { props, user } = setup({ collapsed: { views: true, tags: false } });
    const views = screen.getByRole('button', { name: 'Views' });
    expect(views.getAttribute('aria-expanded')).toBe('false');
    expect(
      screen.queryByRole('button', { name: /Design this week/ }),
    ).toBeNull();
    await user.click(views);
    expect(props.onToggleSection).toHaveBeenLastCalledWith('views');
    const tags = screen.getByRole('button', { name: 'Tags' });
    expect(tags.getAttribute('aria-expanded')).toBe('true');
    tags.focus();
    await user.keyboard('{Enter}');
    expect(props.onToggleSection).toHaveBeenLastCalledWith('tags');
  });

  it('keeps the add button on a collapsed section', () => {
    setup({ collapsed: { views: true, tags: true } });
    expect(screen.getByRole('button', { name: 'New view' })).toBeTruthy();
  });

  it('renames, copies a link to and deletes a view from its menu', async () => {
    const { props, user } = setup();
    const view = props.views[1];
    await user.click(
      screen.getByRole('button', { name: 'Actions for Q3 launch' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    await user.click(
      screen.getByRole('button', { name: 'Actions for Q3 launch' }),
    );
    await user.click(
      await screen.findByRole('menuitem', { name: 'Copy link' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'Actions for Q3 launch' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    expect(view.onRename).toHaveBeenCalledTimes(1);
    expect(view.onCopyLink).toHaveBeenCalledTimes(1);
    expect(view.onDelete).toHaveBeenCalledTimes(1);
    expect(view.onSelect).not.toHaveBeenCalled();
  });

  it('hides view menus when the viewer cannot manage, except on views they own', () => {
    setup({
      canManage: false,
      views: [
        {
          id: 'v1',
          name: 'Shared one',
          count: 1,
          shared: true,
          selected: false,
          onSelect: () => {},
          onRename: () => {},
          onCopyLink: () => {},
          onDelete: () => {},
          canManage: false,
        },
        {
          id: 'v2',
          name: 'Mine',
          count: 1,
          shared: false,
          selected: false,
          onSelect: () => {},
          onRename: () => {},
          onCopyLink: () => {},
          onDelete: () => {},
          canManage: true,
        },
      ],
    });
    expect(
      screen.queryByRole('button', { name: 'Actions for Shared one' }),
    ).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Actions for Mine' }),
    ).toBeTruthy();
  });

  it('names each row by its name and count, never run together', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Home, 10' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Design this week, 3' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'Q3 launch, shared with everyone, 2',
      }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'design, 3' })).toBeTruthy();
  });
});
