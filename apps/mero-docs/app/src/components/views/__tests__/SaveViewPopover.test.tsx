import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SaveViewPopover } from '../SaveViewPopover';

const filters = [
  { icon: 'tag' as const, label: 'design', color: '#8b5cf6' },
  { icon: 'calendar' as const, label: 'Last 7 days' },
];

function setup(
  over: Partial<React.ComponentProps<typeof SaveViewPopover>> = {},
) {
  const onSave = vi.fn();
  render(
    <SaveViewPopover
      trigger={<button type="button">Open save</button>}
      defaultName="Design this week"
      filters={filters}
      workspaceName="Acme Product"
      canShare
      saving={false}
      onSave={onSave}
      {...over}
    />,
  );
  return { onSave, user: userEvent.setup() };
}

describe('SaveViewPopover', () => {
  it('opens from its trigger with the default name, the filters and both scopes', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'Open save' }));
    expect(
      (screen.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value,
    ).toBe('Design this week');
    expect(screen.getByText('design')).toBeTruthy();
    expect(screen.getByText('Last 7 days')).toBeTruthy();
    expect(
      screen
        .getByRole('radio', { name: /Only me/ })
        .getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByRole('radio', { name: /Everyone in Acme Product/ }),
    ).toBeTruthy();
  });

  it('saves with the chosen scope', async () => {
    const { user, onSave } = setup({ open: true });
    await user.click(
      screen.getByRole('radio', { name: /Everyone in Acme Product/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    expect(onSave).toHaveBeenCalledWith({
      name: 'Design this week',
      scope: 'everyone',
    });
  });

  it('submits on Enter with a trimmed name', async () => {
    const { user, onSave } = setup({ open: true });
    const input = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(input);
    await user.type(input, '  Q3 launch  {Enter}');
    expect(onSave).toHaveBeenCalledWith({ name: 'Q3 launch', scope: 'me' });
  });

  it('disables Save for an empty name', async () => {
    const { user, onSave } = setup({ open: true });
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    const save = screen.getByRole('button', {
      name: 'Save view',
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.keyboard('{Enter}');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('disables the shared scope when the viewer cannot share', () => {
    setup({ open: true, canShare: false });
    expect(
      (
        screen.getByRole('radio', {
          name: /Everyone in Acme Product/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it('shows progress while saving', () => {
    setup({ open: true, saving: true });
    expect(
      (screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
