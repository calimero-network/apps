import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileText, Heading1, List } from 'lucide-react';
import { SlashMenu, type SlashMenuItem } from '../SlashMenu';
import { shortcutLabel } from '@/lib/platform';

const ITEMS: SlashMenuItem[] = [
  {
    key: 'heading',
    title: 'Heading 1',
    group: 'Headings',
    shortcut: 'Mod-Alt-1',
    icon: Heading1,
  },
  {
    key: 'bullet_list',
    title: 'Bullet list',
    group: 'Basic blocks',
    shortcut: 'Mod-Shift-8',
    icon: List,
  },
  {
    key: 'doc_link',
    title: 'Link to a document',
    group: 'Links',
    icon: FileText,
  },
];

describe('SlashMenu', () => {
  it('lists items under their group and marks the active row', () => {
    render(<SlashMenu items={ITEMS} activeIndex={1} onPick={() => {}} />);
    const groups = screen.getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'Headings',
      'Basic blocks',
      'Links',
    ]);
    expect(
      within(groups[1]).getByRole('option', { name: /Bullet list/ }),
    ).toHaveProperty('ariaSelected', 'true');
    expect(
      screen.getAllByRole('option').map((o) => o.getAttribute('aria-selected')),
    ).toEqual(['false', 'true', 'false']);
  });

  it('shows shortcuts as key caps for this platform, the same on every row', () => {
    render(<SlashMenu items={ITEMS} activeIndex={0} onPick={() => {}} />);
    const caps = [
      screen.getByText(shortcutLabel('Mod-Alt-1')),
      screen.getByText(shortcutLabel('Mod-Shift-8')),
    ];
    expect(caps.map((k) => k.tagName)).toEqual(['KBD', 'KBD']);
    expect(caps[0].className).toBe(caps[1].className);
  });

  it('picks the clicked item', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<SlashMenu items={ITEMS} activeIndex={0} onPick={onPick} />);
    await user.click(
      screen.getByRole('option', { name: /Link to a document/ }),
    );
    expect(onPick).toHaveBeenCalledWith(ITEMS[2]);
  });

  it('says when nothing matches', () => {
    render(<SlashMenu items={[]} activeIndex={0} onPick={() => {}} />);
    expect(screen.getByText('No matches')).toBeTruthy();
  });
});
