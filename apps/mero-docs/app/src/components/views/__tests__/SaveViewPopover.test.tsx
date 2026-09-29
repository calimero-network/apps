import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SavedViewsContext } from '@/hooks/useSavedViews';
import { SaveViewPopover } from '../SaveViewPopover';

const filters = [
  { icon: 'tag' as const, label: 'design', color: '#8b5cf6' },
  { icon: 'calendar' as const, label: 'Last 7 days' },
];

function setup(
  over: Partial<React.ComponentProps<typeof SaveViewPopover>> = {},
) {
  const save = vi.fn(
    async (name: string, query: string, scope: 'me' | 'everyone') => ({
      id: 'v1',
      name,
      query,
      scope,
    }),
  );
  const onSaved = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <SavedViewsContext.Provider
      value={{ views: [], save, rename: vi.fn(), remove: vi.fn() }}
    >
      <SaveViewPopover
        trigger={<button type="button">Open save</button>}
        defaultName="Design this week"
        filters={filters}
        workspaceName="Acme Product"
        canShare
        query="tag=design"
        onSaved={onSaved}
        onOpenChange={onOpenChange}
        {...over}
      />
    </SavedViewsContext.Provider>,
  );
  return { save, onSaved, onOpenChange, user: userEvent.setup() };
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

  it('refuses a name over the byte limit, with a note under the field', async () => {
    const { user, save: saveView } = setup({ open: true });
    const input = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(input);
    await user.type(input, '名'.repeat(21)); // 21 characters, 63 bytes
    expect(
      screen.getByRole('textbox', {
        name: 'Name',
        description: 'That name is too long.',
      }),
    ).toBeTruthy();
    const save = screen.getByRole('button', { name: 'Save view' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await user.type(input, '{Enter}');
    expect(saveView).not.toHaveBeenCalled();

    await user.type(input, '{Backspace}');
    expect(screen.queryByText('That name is too long.')).toBeNull();
    expect((save as HTMLButtonElement).disabled).toBe(false);
  });

  it('saves the query with the chosen scope, then closes and hands back the view', async () => {
    const { user, save, onSaved, onOpenChange } = setup({ open: true });
    await user.click(
      screen.getByRole('radio', { name: /Everyone in Acme Product/ }),
    );
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    expect(save).toHaveBeenCalledWith(
      'Design this week',
      'tag=design',
      'everyone',
    );
    await waitFor(() =>
      expect(onSaved).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'v1' }),
      ),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('stays open for another try when the save fails', async () => {
    const { user, save, onSaved, onOpenChange } = setup({ open: true });
    save.mockRejectedValueOnce(new Error('offline'));
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'Save view' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('submits on Enter with a trimmed name', async () => {
    const { user, save } = setup({ open: true });
    const input = screen.getByRole('textbox', { name: 'Name' });
    await user.clear(input);
    await user.type(input, '  Q3 launch  {Enter}');
    expect(save).toHaveBeenCalledWith('Q3 launch', 'tag=design', 'me');
  });

  it('disables Save for an empty name', async () => {
    const { user, save: saveView } = setup({ open: true });
    await user.clear(screen.getByRole('textbox', { name: 'Name' }));
    const save = screen.getByRole('button', {
      name: 'Save view',
    }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    await user.keyboard('{Enter}');
    expect(saveView).not.toHaveBeenCalled();
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

  it('shows progress while saving', async () => {
    const { user, save } = setup({ open: true });
    save.mockReturnValueOnce(new Promise(() => {}));
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    expect(
      (screen.getByRole('button', { name: 'Saving…' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
