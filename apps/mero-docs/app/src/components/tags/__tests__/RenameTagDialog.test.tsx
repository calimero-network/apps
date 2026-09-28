import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RenameTagDialog } from '../RenameTagDialog';

describe('RenameTagDialog', () => {
  it('starts from the current name and submits the trimmed new one', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <RenameTagDialog
        open
        name="design"
        onSubmit={onSubmit}
        onOpenChange={() => {}}
      />,
    );
    const input = screen.getByRole('textbox', {
      name: 'Name',
    }) as HTMLInputElement;
    expect(input.value).toBe('design');
    await user.clear(input);
    await user.type(input, '  visual design {Enter}');
    expect(onSubmit).toHaveBeenCalledWith('visual design');
  });

  it('disables Save for an empty name', async () => {
    const user = userEvent.setup();
    render(
      <RenameTagDialog
        open
        name="design"
        onSubmit={() => {}}
        onOpenChange={() => {}}
      />,
    );
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it('shows the error under the field', () => {
    render(
      <RenameTagDialog
        open
        name="design"
        error="A tag with this name already exists"
        onSubmit={() => {}}
        onOpenChange={() => {}}
      />,
    );
    const input = screen.getByRole('textbox', { name: 'Name' });
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText('A tag with this name already exists').id).toBe(
      input.getAttribute('aria-describedby'),
    );
  });

  it('closes from Cancel', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <RenameTagDialog
        open
        name="design"
        onSubmit={() => {}}
        onOpenChange={onOpenChange}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('drops a name-taken error once the name changes, and shows it again on the next save', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <RenameTagDialog
        open
        name="design"
        error="A tag with this name already exists"
        onSubmit={onSubmit}
        onOpenChange={() => {}}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Name' });
    await user.type(field, 'x');
    expect(screen.queryByText('A tag with this name already exists')).toBeNull();
    expect(field.getAttribute('aria-invalid')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalled();
    expect(screen.getByText('A tag with this name already exists')).toBeTruthy();
  });
});
