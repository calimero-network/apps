import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TagChip, TagDot } from '../TagChip';
import { TAG_NEUTRAL } from '@/lib/tags';

// jsdom normalizes any colour value to rgb(), so compare against that
// normalized form rather than the raw hex string.
function toRgb(hex: string): string {
  const probe = document.createElement('div');
  probe.style.backgroundColor = hex;
  return probe.style.backgroundColor;
}

describe('TagDot', () => {
  it('falls back to the neutral colour when none is given', () => {
    render(<TagDot />);
    expect(screen.getByTestId('tag-dot').style.backgroundColor).toBe(toRgb(TAG_NEUTRAL));
  });

  it('uses the given colour', () => {
    render(<TagDot color="#3b82f6" />);
    expect(screen.getByTestId('tag-dot').style.backgroundColor).toBe(toRgb('#3b82f6'));
  });
});

describe('TagChip', () => {
  it('renders the tag name', () => {
    render(<TagChip name="roadmap" color="#3b82f6" />);
    expect(screen.getByText('roadmap')).toBeTruthy();
  });

  it('has no remove button when onRemove is not given', () => {
    render(<TagChip name="roadmap" />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows an accessible remove button when onRemove is given, and calls it', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<TagChip name="roadmap" onRemove={onRemove} />);
    const button = screen.getByRole('button', { name: 'Remove tag roadmap' });
    await user.click(button);
    expect(onRemove).toHaveBeenCalledOnce();
  });

  // The X lives in the dot's slot and is absolutely placed, so the slot, and the chip, are the same size with or without it.
  it('puts the remove button in the dot slot without resizing it', () => {
    const { unmount } = render(<TagChip name="q3" />);
    const plainSlot = screen.getByTestId('tag-dot-slot').className;
    unmount();
    render(<TagChip name="q3" onRemove={() => {}} />);
    const slot = screen.getByTestId('tag-dot-slot');
    expect(slot.className).toBe(plainSlot);
    expect(within(slot).getByRole('button', { name: 'Remove tag q3' }).className).toContain('absolute');
  });

  it('swaps the dot for the X on hover and keyboard focus', () => {
    render(<TagChip name="q3" onRemove={() => {}} />);
    const dot = screen.getByTestId('tag-dot').className;
    expect(dot).toContain('group-hover:opacity-0');
    expect(dot).toContain('group-focus-within:opacity-0');
    const remove = screen.getByRole('button', { name: 'Remove tag q3' }).className;
    expect(remove).toContain('group-hover:opacity-100');
    expect(remove).toContain('group-focus-within:opacity-100');
    expect(remove).toContain('focus-visible:ring-1');
  });

  it('keeps the dot of a plain chip visible', () => {
    render(<TagChip name="q3" />);
    expect(screen.getByTestId('tag-dot').className).not.toContain('opacity-0');
  });

  it('removes from the keyboard', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<TagChip name="q3" onRemove={onRemove} />);
    await user.tab();
    await user.keyboard('{Enter}');
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('applies the lg size', () => {
    render(<TagChip name="roadmap" size="lg" />);
    expect(screen.getByText('roadmap').className).toContain('h-6');
  });
});
