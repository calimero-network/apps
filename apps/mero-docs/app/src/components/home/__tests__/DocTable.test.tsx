import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DocTable } from '../DocTable';
import type { DocRowView } from '../types';

const BOB = { id: 'bob', name: 'Bob Stone', colour: '#ef4444' };

function row(over: Partial<DocRowView> = {}): DocRowView {
  return {
    key: 'f1/d1',
    title: 'Q3 launch plan',
    folderPath: ['Engineering', 'Specs'],
    folderColor: '#10b981',
    tags: [],
    here: [],
    updatedLabel: '2 min ago',
    ...over,
  };
}

describe('DocTable', () => {
  it('renders the title, folder path, live pill and updated label', () => {
    render(
      <DocTable rows={[row({ liveLabel: 'Bob is here' })]} onOpen={() => {}} />,
    );
    const link = screen.getByRole('link', { name: 'Q3 launch plan' });
    expect(link.textContent).toContain('Engineering');
    expect(link.textContent).toContain('Specs');
    expect(screen.getByText('Bob is here')).toBeTruthy();
    expect(screen.getAllByText('2 min ago').length).toBeGreaterThan(0);
  });

  it('names an empty title "Untitled"', () => {
    render(<DocTable rows={[row({ title: '' })]} onOpen={() => {}} />);
    expect(screen.getByRole('link', { name: 'Untitled' })).toBeTruthy();
  });

  it('truncates a long title', () => {
    render(
      <DocTable
        rows={[row({ title: 'A very long title '.repeat(20) })]}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByTestId('doc-title').className).toContain('truncate');
  });

  it('opens on click and on Enter', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<DocTable rows={[row()]} onOpen={onOpen} />);
    await user.click(screen.getByRole('link', { name: 'Q3 launch plan' }));
    expect(onOpen).toHaveBeenCalledWith('f1/d1');
    screen.getByRole('link', { name: 'Q3 launch plan' }).focus();
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('opens in a new tab on Cmd/Ctrl+Enter, modifier click and middle click', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onOpenInNewTab = vi.fn();
    render(
      <DocTable
        rows={[row()]}
        onOpen={onOpen}
        onOpenInNewTab={onOpenInNewTab}
      />,
    );
    const link = screen.getByRole('link', { name: 'Q3 launch plan' });
    link.focus();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    await user.keyboard('{Control>}{Enter}{/Control}');
    fireEvent.click(link, { metaKey: true });
    fireEvent(link, new MouseEvent('auxclick', { bubbles: true, button: 1 }));
    expect(onOpenInNewTab).toHaveBeenCalledTimes(4);
    expect(onOpenInNewTab).toHaveBeenCalledWith('f1/d1');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('falls back to onOpen for a modifier open when no new-tab handler is given', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<DocTable rows={[row()]} onOpen={onOpen} />);
    screen.getByRole('link', { name: 'Q3 launch plan' }).focus();
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(onOpen).toHaveBeenCalledWith('f1/d1');
  });

  it('shows at most three tags, then +N', () => {
    const tags = ['a', 'b', 'c', 'd', 'e'].map((n) => ({ key: n, name: n }));
    render(<DocTable rows={[row({ tags })]} onOpen={() => {}} />);
    expect(screen.getByText('c')).toBeTruthy();
    expect(screen.queryByText('d')).toBeNull();
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('shows at most three people here, then +N', () => {
    const here = ['Ann Lee', 'Bob Stone', 'Cy Dunn', 'Di Ma'].map(
      (name, i) => ({ id: String(i), name, colour: '#000' }),
    );
    render(<DocTable rows={[row({ here })]} onOpen={() => {}} />);
    expect(screen.getByText('AL')).toBeTruthy();
    expect(screen.getByText('CD')).toBeTruthy();
    expect(screen.queryByText('DM')).toBeNull();
    expect(screen.getByText('+1')).toBeTruthy();
    expect(
      screen.getByLabelText('Here now: Ann Lee, Bob Stone, Cy Dunn, Di Ma'),
    ).toBeTruthy();
  });

  it('marks an archived row', () => {
    render(
      <DocTable
        rows={[row({ archived: true, here: [BOB] })]}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText('Archived')).toBeTruthy();
  });
});
