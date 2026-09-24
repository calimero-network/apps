import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NamespaceSwitcher } from '../NamespaceSwitcher';

const selectNamespace = vi.fn();
const driveState = {
  namespaces: [
    { namespaceId: 'ns-acme', name: 'Acme Product', memberCount: 4 },
    { namespaceId: 'ns-solo', name: 'Personal', memberCount: 1 },
  ] as Array<{ namespaceId: string; name?: string; memberCount: number }>,
  selectedNamespaceId: 'ns-acme' as string | null,
  selectNamespace,
  loading: false,
  error: null as Error | null,
  refetch: vi.fn(),
};
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => driveState,
}));
vi.mock('../NamespaceCreateDialog', () => ({
  NamespaceCreateDialog: () => <div role="dialog" aria-label="create dialog" />,
}));
vi.mock('../NamespaceJoinDialog', () => ({
  NamespaceJoinDialog: () => <div role="dialog" aria-label="join dialog" />,
}));

// Radix DropdownMenu opens on pointerdown in jsdom.
function openMenu() {
  fireEvent.pointerDown(screen.getByTestId('workspace-switcher'), {
    button: 0,
    ctrlKey: false,
  });
}

describe('NamespaceSwitcher', () => {
  beforeEach(() => {
    selectNamespace.mockReset();
    driveState.selectedNamespaceId = 'ns-acme';
  });

  it('shows the active workspace on the trigger', () => {
    render(<NamespaceSwitcher />);
    expect(screen.getByTestId('workspace-switcher').textContent).toBe(
      'APAcme Product',
    );
  });

  it('reads "No workspace" when none is selected', () => {
    driveState.selectedNamespaceId = null;
    render(<NamespaceSwitcher />);
    expect(screen.getByTestId('workspace-switcher').textContent).toBe(
      'No workspace',
    );
  });

  it('lists workspaces with the active one checked and switches on select', () => {
    render(<NamespaceSwitcher />);
    openMenu();
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
    ]);
    expect(items[1].textContent).toBe('PEPersonal1 member');
    fireEvent.click(items[1]);
    expect(selectNamespace).toHaveBeenCalledWith('ns-solo');
  });

  it('opens the create and join dialogs from the menu', () => {
    render(<NamespaceSwitcher />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /New workspace/i }));
    expect(screen.getByRole('dialog', { name: 'create dialog' })).toBeTruthy();
    openMenu();
    fireEvent.click(
      screen.getByRole('menuitem', { name: /Join with invite link/i }),
    );
    expect(screen.getByRole('dialog', { name: 'join dialog' })).toBeTruthy();
  });
});
