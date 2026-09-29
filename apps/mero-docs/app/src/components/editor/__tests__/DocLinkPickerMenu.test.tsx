import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  DocLinkPickerMenu,
  type DocLinkPickerItem,
} from '../DocLinkPickerMenu';

const ITEMS: DocLinkPickerItem[] = [
  {
    id: 'doc-7',
    kind: 'doc',
    title: 'Pricing notes',
    titleRanges: [[0, 4]],
    folderLabel: 'Product',
  },
  {
    id: 'doc-6',
    kind: 'text',
    title: 'Design review notes',
    quote: 'Pricing page',
    quoteRanges: [[0, 4]],
    folderLabel: 'Design',
  },
];

describe('DocLinkPickerMenu', () => {
  it('labels the list and marks the active row', () => {
    render(
      <DocLinkPickerMenu items={ITEMS} activeIndex={1} onPick={() => {}} />,
    );
    expect(
      screen.getByRole('listbox', { name: 'Mention or link' }),
    ).toBeTruthy();
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
    ]);
    expect(options[1].textContent).toBe(
      'Design review notes · “Pricing page”Design',
    );
  });

  it('highlights the matched part of the title', () => {
    render(
      <DocLinkPickerMenu items={ITEMS} activeIndex={0} onPick={() => {}} />,
    );
    expect(screen.getAllByText('Pric').map((m) => m.tagName)).toEqual([
      'MARK',
      'MARK',
    ]);
  });

  it('picks the clicked item', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<DocLinkPickerMenu items={ITEMS} activeIndex={0} onPick={onPick} />);
    await user.click(
      screen.getByRole('option', { name: /Design review notes/ }),
    );
    expect(onPick).toHaveBeenCalledWith(ITEMS[1]);
  });

  it('says when nothing matches', () => {
    render(<DocLinkPickerMenu items={[]} activeIndex={0} onPick={() => {}} />);
    expect(screen.getByText('No people or documents match')).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('groups people before documents, keeping one row order for the keyboard', () => {
    const grouped: DocLinkPickerItem[] = [
      {
        id: 'person:b',
        kind: 'person',
        group: 'People',
        title: 'Bob',
        folderLabel: "Can't open this folder",
      },
      {
        id: 'person:me',
        kind: 'person',
        group: 'People',
        title: 'You',
        folderLabel: '',
      },
      { ...ITEMS[0], group: 'Documents' },
    ];
    render(
      <DocLinkPickerMenu items={grouped} activeIndex={2} onPick={() => {}} />,
    );
    const groups = screen.getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'People',
      'Documents',
    ]);
    expect(groups.map((g) => g.textContent)).toEqual([
      "PeopleBobCan't open this folderYou",
      'DocumentsPricing notesProduct',
    ]);
    const options = screen.getAllByRole('option');
    expect(options.map((o) => o.id)).toEqual([
      'bn-suggestion-menu-item-0',
      'bn-suggestion-menu-item-1',
      'bn-suggestion-menu-item-2',
    ]);
    expect(options[2].getAttribute('aria-selected')).toBe('true');
  });

  it('names the section picker by what it links', () => {
    render(
      <DocLinkPickerMenu
        mode="section"
        items={[
          {
            id: 'section:f1/d1:h1',
            kind: 'section',
            title: 'Goals',
            folderLabel: 'Q3 launch plan',
          },
        ]}
        activeIndex={0}
        onPick={() => {}}
      />,
    );
    expect(
      screen.getByRole('listbox', { name: 'Link to a section' }),
    ).toBeTruthy();
    expect(screen.getByRole('option').textContent).toBe('GoalsQ3 launch plan');
  });

  it('says when no section matches', () => {
    render(
      <DocLinkPickerMenu
        mode="section"
        items={[]}
        activeIndex={0}
        onPick={() => {}}
      />,
    );
    expect(screen.getByText('No sections match')).toBeTruthy();
  });
});
