import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagPageHeader } from '../TagPageHeader';

type HeaderProps = React.ComponentProps<typeof TagPageHeader>;

function setup(over: Partial<HeaderProps> = {}) {
  const props: HeaderProps = {
    name: 'design',
    color: '#8b5cf6',
    subtitle: '3 documents in 3 folders',
    canManage: true,
    onRename: vi.fn(),
    onRecolor: vi.fn(),
    onDelete: vi.fn(),
    ...over,
  };
  render(<TagPageHeader {...props} />);
  return { props, user: userEvent.setup() };
}

describe('TagPageHeader', () => {
  it('titles the page with the tag name and subtitle', () => {
    setup();
    expect(
      screen.getByRole('heading', { level: 1, name: 'design' }),
    ).toBeTruthy();
    expect(screen.getByText('3 documents in 3 folders')).toBeTruthy();
  });

  it('renames from the Rename button', async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(props.onRename).toHaveBeenCalledTimes(1);
  });

  it('recolours from the More menu with named swatches, by keyboard', async () => {
    const { props, user } = setup();
    screen.getByRole('button', { name: 'More' }).focus();
    await user.keyboard('{Enter}');
    await screen.findByRole('menuitem', { name: 'Colour' });
    await user.keyboard('{ArrowRight}');
    const teal = await screen.findByRole('menuitemradio', { name: 'Teal' });
    expect(
      screen
        .getByRole('menuitemradio', { name: 'Purple' })
        .getAttribute('aria-checked'),
    ).toBe('true');
    teal.focus();
    await user.keyboard('{Enter}');
    expect(props.onRecolor).toHaveBeenCalledWith('#14b8a6');
  });

  it('deletes from the More menu', async () => {
    const { props, user } = setup();
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Delete tag' }),
    );
    expect(props.onDelete).toHaveBeenCalledTimes(1);
  });

  it('hides every action when the viewer cannot manage tags', () => {
    setup({ canManage: false });
    expect(screen.queryByRole('button', { name: 'Rename' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  });
});
