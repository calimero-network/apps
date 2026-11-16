import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { NamespaceSwitcher } from '../NamespaceSwitcher';

const selectNamespace = vi.fn();
const driveState = {
  namespaces: [
    { namespaceId: 'ns-acme', name: 'Acme Product', memberCount: 4 },
    { namespaceId: 'ns-solo', name: 'Personal', memberCount: 1 },
  ] as Array<{ namespaceId: string; name?: string; memberCount: number }>,
  selectedNamespaceId: 'ns-acme' as string | null,
  selectNamespace,
  // The selected workspace's TEE node: counted by core, not a person.
  namespaceMembers: { teeMembers: [{ identity: 'e'.repeat(64), role: 'RelayTee' }] },
  loading: false,
  error: null as Error | null,
  refetch: vi.fn(),
  workspaceCreated: undefined as unknown,
};
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => driveState,
}));
const workspaceCreated = vi.fn();
driveState.workspaceCreated = workspaceCreated;
vi.mock('@/calimero/session', () => ({
  useSession: () => ({
    session: { status: 'signed-in', target: { kind: 'local', nodes: [] } },
    passkey: () => ({}),
    source: { package: 'com.example.docs', version: '1.0.0' },
    resolvingSource: false,
  }),
}));
vi.mock('@/calimero/react', () => ({ useLive: () => ({ client: {} }) }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
// The shared dialog is mero-react's to test: here only what the switcher hands it and does after.
vi.mock('@calimero-apps/passkey', () => ({
  WorkspaceCreator: (p: {
    open: boolean;
    labels?: { title?: string };
    onCreated: (c: { orgId: string; selfName: string }) => void;
  }) =>
    p.open ? (
      <div role="dialog" aria-label="create dialog">
        <h2>{p.labels?.title}</h2>
        <button onClick={() => p.onCreated({ orgId: 'ns-new', selfName: 'Ada' })}>done</button>
      </div>
    ) : null,
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
      'Acme Product',
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
    expect(items[0].textContent).toBe('Acme Product3 members');
    expect(items[1].textContent).toBe('Personal1 member');
    fireEvent.click(items[1]);
    expect(selectNamespace).toHaveBeenCalledWith('ns-solo');
  });

  it('opens the create dialog from the menu', () => {
    render(<NamespaceSwitcher />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /New workspace/i }));
    expect(screen.getByRole('dialog', { name: 'create dialog' })).toBeTruthy();
  });

  it('finishes the workspace the dialog made and closes it', async () => {
    workspaceCreated.mockResolvedValueOnce(undefined);
    render(<NamespaceSwitcher />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /New workspace/i }));
    fireEvent.click(screen.getByRole('button', { name: 'done' }));
    await waitFor(() => expect(workspaceCreated).toHaveBeenCalledWith({ orgId: 'ns-new', selfName: 'Ada' }));
    expect(screen.queryByRole('dialog', { name: 'create dialog' })).toBeNull();
  });

  it("says why finishing the workspace failed, in the node's words", async () => {
    workspaceCreated.mockRejectedValueOnce(new Error('registry refused'));
    render(<NamespaceSwitcher />);
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: /New workspace/i }));
    fireEvent.click(screen.getByRole('button', { name: 'done' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('registry refused'));
  });

  // An invitation is joined by opening its link; there is nowhere to paste one.
  it('offers no way to join by pasting a link', () => {
    render(<NamespaceSwitcher />);
    openMenu();
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual([
      'New workspace',
    ]);
  });
});
