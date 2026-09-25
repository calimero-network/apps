import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { WorkspaceSidebar } from '../WorkspaceSidebar';

describe('WorkspaceSidebar', () => {
  it('renders children at the given width', () => {
    const { container } = render(
      <WorkspaceSidebar width={300} onWidthChange={vi.fn()}>
        <div>tree</div>
      </WorkspaceSidebar>,
    );
    expect(screen.getByText('tree')).toBeTruthy();
    // <aside> has no semantic role; asserting inline style.width requires direct DOM access.
    // eslint-disable-next-line testing-library/no-container, testing-library/no-node-access
    const aside = container.querySelector('aside');
    expect(aside?.style.width).toBe('300px');
  });

  it('reports a clamped new width while dragging the handle', () => {
    const onWidthChange = vi.fn();
    render(
      <WorkspaceSidebar
        width={300}
        minWidth={200}
        maxWidth={480}
        onWidthChange={onWidthChange}
      >
        <div>tree</div>
      </WorkspaceSidebar>,
    );
    const handle = screen.getByRole('separator');
    fireEvent.pointerDown(handle, { clientX: 300 });
    // drag far right past max → clamps to 480
    fireEvent.pointerMove(window, { clientX: 900 });
    expect(onWidthChange).toHaveBeenLastCalledWith(480);
    // drag far left past min → clamps to 200
    fireEvent.pointerMove(window, { clientX: 0 });
    expect(onWidthChange).toHaveBeenLastCalledWith(200);
    fireEvent.pointerUp(window);
    onWidthChange.mockClear();
    fireEvent.pointerMove(window, { clientX: 250 });
    expect(onWidthChange).not.toHaveBeenCalled();
  });
});
