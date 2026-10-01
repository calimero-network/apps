import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NameDialog } from '../NameDialog';

describe('NameDialog', () => {
  it('starts from the current name and submits the trimmed new one', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <NameDialog
        open
        title="Rename tag"
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
    expect(onSubmit).toHaveBeenCalledWith('visual design', undefined);
  });

  it('disables Save for an empty name', async () => {
    const user = userEvent.setup();
    render(
      <NameDialog
        open
        title="Rename tag"
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
      <NameDialog
        open
        title="Rename tag"
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

  it('titles itself as the caller says', () => {
    render(
      <NameDialog
        open
        title="Rename view"
        name="design"
        onSubmit={() => {}}
        onOpenChange={() => {}}
      />,
    );
    expect(screen.getByText('Rename view')).toBeTruthy();
  });

  it('closes from Cancel', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <NameDialog
        open
        title="Rename tag"
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
      <NameDialog
        open
        title="Rename tag"
        name="design"
        error="A tag with this name already exists"
        onSubmit={onSubmit}
        onOpenChange={() => {}}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Name' });
    await user.type(field, 'x');
    expect(
      screen.queryByText('A tag with this name already exists'),
    ).toBeNull();
    expect(field.getAttribute('aria-invalid')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSubmit).toHaveBeenCalled();
    expect(
      screen.getByText('A tag with this name already exists'),
    ).toBeTruthy();
  });
});

function mount(props: Partial<React.ComponentProps<typeof NameDialog>> = {}) {
  const onSubmit = vi.fn();
  render(
    <NameDialog
      open
      title="New tag"
      submitLabel="Create"
      color="#10b981"
      onSubmit={onSubmit}
      onOpenChange={() => {}}
      {...props}
    />,
  );
  return { onSubmit, user: userEvent.setup() };
}

describe('NameDialog with a colour', () => {
  it('submits the name with the colour picked, starting from the one given', async () => {
    const { onSubmit, user } = mount();
    expect(
      (screen.getByRole('radio', { name: 'Green' }) as HTMLInputElement)
        .checked,
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

  it('drops a name-taken error once the name changes, and shows it again on the next save', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <NameDialog
        open
        title="New tag"
        submitLabel="Create"
        color="#10b981"
        error="A tag with this name already exists"
        onSubmit={onSubmit}
        onOpenChange={() => {}}
      />,
    );
    const field = screen.getByRole('textbox', { name: 'Name' });
    await user.type(field, 'x');
    expect(
      screen.queryByText('A tag with this name already exists'),
    ).toBeNull();
    expect(field.getAttribute('aria-invalid')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalled();
    expect(
      screen.getByText('A tag with this name already exists'),
    ).toBeTruthy();
  });
});
