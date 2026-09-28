import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewTagDialog } from '../NewTagDialog';

function mount(props: Partial<React.ComponentProps<typeof NewTagDialog>> = {}) {
  const onSubmit = vi.fn();
  render(
    <NewTagDialog
      open
      color="#10b981"
      onSubmit={onSubmit}
      onOpenChange={() => {}}
      {...props}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
}

describe('NewTagDialog', () => {
  it('submits the name with the colour picked, starting from the one given', async () => {
    const { onSubmit, user } = mount();
    expect(
      (screen.getByRole('radio', { name: 'Green' }) as HTMLInputElement).checked,
    ).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'launch');
    await user.click(screen.getByRole('radio', { name: 'Red' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledWith('launch', '#ef4444');
  });

  it('disables Create until the name has more than spaces', async () => {
    const { user } = mount();
    const create = screen.getByRole('button', { name: 'Create' });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole('textbox', { name: 'Name' }), '   ');
    expect((create as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows an error against the field', () => {
    mount({ error: 'A tag with this name already exists' });
    const field = screen.getByRole('textbox', { name: 'Name' });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(
      screen.getByText('A tag with this name already exists').id,
    );
  });
});
