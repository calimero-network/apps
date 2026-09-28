import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddTagPopover } from '../AddTagPopover';

const SUGGESTIONS = [
  { key: 'launch', name: 'launch', color: '#f59e0b', countLabel: '1 doc' },
  { key: 'launches', name: 'launches', countLabel: '3 docs' },
];

interface HarnessProps {
  initialOpen?: boolean;
  canCreate?: boolean;
  onOpenChange?: (open: boolean) => void;
  onPick?: (key: string) => void;
  onCreate?: () => void;
  onColorChange?: (color: string) => void;
}

function Harness({
  initialOpen = true,
  canCreate = true,
  onOpenChange = () => {},
  onPick = () => {},
  onCreate = () => {},
  onColorChange = () => {},
}: HarnessProps) {
  const [open, setOpen] = React.useState(initialOpen);
  const [query, setQuery] = React.useState('lau');
  const [color, setColor] = React.useState('#f59e0b');
  return (
    <AddTagPopover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        onOpenChange(next);
      }}
      query={query}
      onQueryChange={setQuery}
      suggestions={SUGGESTIONS}
      canCreate={canCreate}
      createLabel={query}
      color={color}
      onColorChange={(next) => {
        setColor(next);
        onColorChange(next);
      }}
      onPick={onPick}
      onCreate={onCreate}
    />
  );
}

// jsdom runs no CSS animations, so Radix unmounts closed content at once; a
// browser keeps it for the exit animation, and a reopen then reuses it.
function keepClosingContentMounted() {
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const style = real(el, pseudo);
    if (!(el instanceof HTMLElement) || !el.dataset.state) return style;
    return new Proxy(style, {
      get(target, key) {
        if (key === 'animationName')
          return el.dataset.state === 'closed' ? 'exit' : 'enter';
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
}

function activeOption(): string | null {
  const input = screen.getByRole('combobox');
  const id = input.getAttribute('aria-activedescendant');
  const active = screen.getAllByRole('option').find((o) => o.id === id);
  return active?.textContent ?? null;
}

describe('AddTagPopover', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens from the Add tag button', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness initialOpen={false} onOpenChange={onOpenChange} />);
    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(await screen.findByRole('combobox')).toBeTruthy();
  });

  it('focuses the input on open', async () => {
    render(<Harness />);
    const input = await screen.findByRole('combobox');
    expect(input.matches(':focus')).toBe(true);
  });

  it('focuses the input when reopened while its close animation still runs', async () => {
    keepClosingContentMounted();
    const user = userEvent.setup();
    render(<Harness />);
    const input = await screen.findByRole('combobox');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    expect(screen.getByRole('combobox')).toBe(input);
    expect(input.matches(':focus')).toBe(true);
  });

  it('picks the first suggestion on Enter', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await screen.findByRole('combobox');
    expect(activeOption()).toContain('launch');
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('launch');
  });

  it('moves over suggestion and create rows with the arrows, and Enter on create creates', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const onCreate = vi.fn();
    render(<Harness onPick={onPick} onCreate={onCreate} />);
    await screen.findByRole('combobox');
    await user.keyboard('{ArrowDown}');
    expect(activeOption()).toContain('launches');
    await user.keyboard('{ArrowDown}');
    expect(activeOption()).toBe('Create tag “lau”');
    await user.keyboard('{ArrowDown}');
    expect(activeOption()).toBe('Create tag “lau”');
    await user.keyboard('{Enter}');
    expect(onCreate).toHaveBeenCalledOnce();
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}{Enter}');
    expect(onPick).toHaveBeenCalledWith('launch');
  });

  it('starts over at the first row when the query changes', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByRole('combobox');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    await user.keyboard('n');
    expect(activeOption()).toContain('launch');
  });

  it('keeps the active row in range when the rows shrink under it', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const { rerender } = render(<Harness onPick={onPick} />);
    await screen.findByRole('combobox');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    rerender(<Harness onPick={onPick} canCreate={false} />);
    expect(activeOption()).toContain('launches');
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledWith('launches');
  });

  it('has no create row when a tag cannot be created', async () => {
    render(<Harness canCreate={false} />);
    await screen.findByRole('combobox');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.queryByText(/Create tag/)).toBeNull();
  });

  it('picks a suggestion on click', async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(<Harness onPick={onPick} />);
    await user.click(await screen.findByRole('option', { name: /launches/ }));
    expect(onPick).toHaveBeenCalledWith('launches');
  });

  it('offers the tag colours as a named radio group', async () => {
    const user = userEvent.setup();
    const onColorChange = vi.fn();
    render(<Harness onColorChange={onColorChange} />);
    const group = await screen.findByRole('radiogroup', {
      name: 'Colour for a new tag',
    });
    expect(group).toBeTruthy();
    const names = screen
      .getAllByRole('radio')
      .map((r) => r.getAttribute('aria-label'));
    expect(names).toEqual([
      'Blue',
      'Purple',
      'Green',
      'Amber',
      'Pink',
      'Red',
      'Teal',
      'Slate',
    ]);
    expect(
      (screen.getByRole('radio', { name: 'Amber' }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    await user.click(screen.getByRole('radio', { name: 'Pink' }));
    expect(onColorChange).toHaveBeenCalledWith('#ec4899');
    expect(
      (screen.getByRole('radio', { name: 'Pink' }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('reaches the checked swatch with Tab', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByRole('combobox');
    await user.tab();
    expect(screen.getByRole('radio', { name: 'Amber' }).matches(':focus')).toBe(
      true,
    );
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);
    await screen.findByRole('combobox');
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByRole('combobox')).toBeNull();
  });
});
