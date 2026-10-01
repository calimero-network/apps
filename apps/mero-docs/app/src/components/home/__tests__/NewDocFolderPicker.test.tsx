import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewDocFolderPicker } from '../NewDocFolderPicker';

const folder = (id: string, name: string, path: string[] = [name]) => ({
  id,
  name,
  path,
});

describe('NewDocFolderPicker', () => {
  it('lists the folders with their path and picks one', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <NewDocFolderPicker
        open
        folders={[
          folder('p', 'Product'),
          folder('s', 'Specs', ['Engineering', 'Specs']),
        ]}
        onPick={onPick}
        onOpenChange={() => {}}
      />,
    );
    expect(
      screen.getByRole('dialog', { name: 'New document in…' }),
    ).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    await user.click(
      screen.getByRole('button', { name: /Engineering.*Specs/ }),
    );
    expect(onPick).toHaveBeenCalledWith('s');
  });

  it('adds a filter input past six folders and filters by name', async () => {
    const user = userEvent.setup();
    const names = [
      'Product',
      'Design',
      'Engineering',
      'Marketing',
      'Finance',
      'Legal',
      'Sales',
    ];
    render(
      <NewDocFolderPicker
        open
        folders={names.map((n) => folder(n, n))}
        onPick={() => {}}
        onOpenChange={() => {}}
      />,
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Filter folders' }),
      'mar',
    );
    expect(screen.getByRole('button', { name: /Marketing/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Product/ })).toBeNull();
    await user.clear(screen.getByRole('textbox', { name: 'Filter folders' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Filter folders' }),
      'zzz',
    );
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('filters by path words in any order, and typos only when nothing matches exactly', async () => {
    const user = userEvent.setup();
    const names = ['Product', 'Design', 'Marketing', 'Finance', 'Legal'];
    render(
      <NewDocFolderPicker
        open
        folders={[
          ...names.map((n) => folder(n, n)),
          folder('s', 'Specs', ['Engineering', 'Specs']),
          folder('r', 'Reads', ['Reads']),
        ]}
        onPick={() => {}}
        onOpenChange={() => {}}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Filter folders' });
    const shown = () => screen.getAllByRole('button').map((b) => b.textContent);
    await user.type(field, 'specs engineering');
    expect(shown()).toContain('Engineering / Specs');
    expect(shown()).not.toContain('Product');
    await user.clear(field);
    await user.type(field, 'markteing');
    expect(shown()).toContain('Marketing');
    await user.clear(field);
    await user.type(field, 'read');
    expect(shown()).toContain('Reads');
    expect(shown()).not.toContain('Design');
  });

  it('lists folders by name, case and accents aside', () => {
    render(
      <NewDocFolderPicker
        open
        folders={[
          folder('p', 'Product'),
          folder('d', 'design'),
          folder('e', 'Éditorial'),
          folder('s', 'Specs', ['Engineering', 'Specs']),
        ]}
        onPick={() => {}}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'design',
      'Éditorial',
      'Engineering / Specs',
      'Product',
    ]);
  });
});
