import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NamespaceCreateDialog } from '../NamespaceCreateDialog';

// createWorkspace flips its own `loading` via real useState, so the dialog's
// submitting-gated close can be exercised without a real create round-trip.
const created = vi.fn();
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => {
    const [loading, setLoading] = React.useState(false);
    const createWorkspace = React.useCallback(async (...args: unknown[]) => {
      created(...args);
      setLoading(true);
      return new Promise<string | null>(() => {}); // never resolves: simulates in-flight create
    }, []);
    return {
      createWorkspace,
      createWorkspaceLoading: loading,
      createWorkspaceError: null,
    };
  },
}));

beforeEach(() => {
  created.mockReset();
  localStorage.clear();
});

describe('NamespaceCreateDialog closing', () => {
  it('closes on Escape even when focus is not on the name input', async () => {
    const onClose = vi.fn();
    render(<NamespaceCreateDialog onClose={onClose} />);
    const user = userEvent.setup();
    await user.tab(); // move focus off the autoFocused input
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('ignores Escape while the workspace is being created', async () => {
    const onClose = vi.fn();
    render(<NamespaceCreateDialog onClose={onClose} />);
    const user = userEvent.setup();
    await user.type(
      screen.getByPlaceholderText('Workspace name'),
      'Slow Co',
    );
    await user.type(
      screen.getByPlaceholderText('Your name in this workspace'),
      'Ada',
    );
    await user.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByRole('button', { name: 'Creating…' });
    await user.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('NamespaceCreateDialog asks your name in the workspace', () => {
  it('needs a name, and hands it to the create with the workspace', async () => {
    render(<NamespaceCreateDialog onClose={vi.fn()} />);
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Workspace name'), 'Acme');
    expect(
      screen.getByRole('button', { name: 'Create' }).hasAttribute('disabled'),
    ).toBe(true);
    await user.type(
      screen.getByPlaceholderText('Your name in this workspace'),
      '  Ada  ',
    );
    await user.click(screen.getByRole('button', { name: 'Create' }));
    expect(created).toHaveBeenCalledWith('Acme', 'Ada');
  });

  it('offers the name last used in another workspace', () => {
    localStorage.setItem('calimero-names:last', 'Grace');
    render(<NamespaceCreateDialog onClose={vi.fn()} />);
    expect(
      (
        screen.getByPlaceholderText(
          'Your name in this workspace',
        ) as HTMLInputElement
      ).value,
    ).toBe('Grace');
  });
});
