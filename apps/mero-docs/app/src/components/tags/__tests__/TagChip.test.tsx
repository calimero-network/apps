import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  // Absolutely placed over the trailing edge, so a removable chip is as wide as a plain one.
  it('overlays the remove button instead of reserving room for it', () => {
    render(<TagChip name="roadmap" onRemove={() => {}} />);
    expect(screen.getByRole('button', { name: 'Remove tag roadmap' }).className).toContain('absolute');
  });

  it('applies the lg size', () => {
    render(<TagChip name="roadmap" size="lg" />);
    expect(screen.getByText('roadmap').className).toContain('h-6');
  });
});
