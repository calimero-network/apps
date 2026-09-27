import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TopBarSearch } from '../TopBarSearch';

// jsdom applies no CSS, so the breakpoint split is checked through the classes that drive it.
function classesOf(el: HTMLElement): string[] {
  return el.className.split(/\s+/);
}

describe('TopBarSearch', () => {
  it('shows the field with the shortcut only from md, and opens on click', async () => {
    const onOpen = vi.fn();
    render(<TopBarSearch onOpen={onOpen} shortcutLabel="⌘K" />);
    const field = screen.getByRole('button', { name: 'Search docs, folders and tags' });
    expect(field.textContent).toContain('Search docs, folders and #tags');
    expect(field.textContent).toContain('⌘K');
    expect(classesOf(field)).toEqual(expect.arrayContaining(['hidden', 'md:flex']));
    await userEvent.click(field);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows an icon button only below md, and opens on click', async () => {
    const onOpen = vi.fn();
    render(<TopBarSearch onOpen={onOpen} shortcutLabel="Ctrl K" />);
    const icon = screen.getByRole('button', { name: 'Search' });
    expect(classesOf(icon)).toContain('md:hidden');
    await userEvent.click(icon);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
