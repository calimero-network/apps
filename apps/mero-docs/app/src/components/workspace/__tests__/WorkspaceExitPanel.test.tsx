import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { WorkspaceExitPanel } from '../WorkspaceExitPanel';

// The reported bug: an Admin was offered "Leave" for a workspace and had no
// way to delete it. An Admin deletes; anyone else leaves; neither is offered
// the other's control.

const h = vi.hoisted(() => ({
  caps: { caps: 0 as number | null, isAdmin: false },
  isDelegated: false,
  admin: {
    deleteNamespace: vi.fn(async () => ({ isDeleted: true })),
    leaveNamespace: vi.fn(async (): Promise<{ left: 'app' | 'org'; lastApp: boolean } | undefined> => undefined),
    leaveOrganization: vi.fn(async () => undefined),
  },
  confirms: [] as string[],
  answer: true,
  clearNamespace: vi.fn(),
  refetch: vi.fn(async () => undefined),
}));

vi.mock('@/calimero/react', () => ({
  useMero: () => ({ admin: h.admin, isDelegated: h.isDelegated }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns',
    rootGroupId: 'ns',
    namespaces: [{ namespaceId: 'ns', name: 'Acme' }],
    clearNamespace: h.clearNamespace,
    refetch: h.refetch,
  }),
}));
vi.mock('@/hooks/useMemberCaps', () => ({
  useMemberCaps: () => h.caps,
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => async (o: { title: string }) => {
    h.confirms.push(o.title);
    return o.title.startsWith('Leave the organization') ? h.answer : true;
  },
}));

afterEach(() => {
  vi.clearAllMocks();
  h.caps = { caps: 0, isAdmin: false };
  h.isDelegated = false;
  h.confirms = [];
  h.answer = true;
});

describe('WorkspaceExitPanel', () => {
  it('offers an Admin Delete, never Leave, and deletes the namespace', async () => {
    h.caps = { caps: 0xffffffff, isAdmin: true };
    render(<WorkspaceExitPanel />);
    expect(screen.queryByRole('button', { name: /leave workspace/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /delete workspace/i }));
    await waitFor(() => expect(h.admin.deleteNamespace).toHaveBeenCalledWith('ns'));
    expect(h.admin.leaveNamespace).not.toHaveBeenCalled();
    expect(h.clearNamespace).toHaveBeenCalled();
  });

  it('offers a non-admin Leave, never Delete, and leaves the namespace', async () => {
    render(<WorkspaceExitPanel />);
    expect(screen.queryByRole('button', { name: /delete workspace/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /leave workspace/i }));
    await waitFor(() => expect(h.admin.leaveNamespace).toHaveBeenCalledWith('ns'));
    expect(h.admin.deleteNamespace).not.toHaveBeenCalled();
  });

  it('left Docs only, the last app in an org that keeps its apps apart: asks, then leaves the org too', async () => {
    h.admin.leaveNamespace.mockResolvedValueOnce({ left: 'app', lastApp: true });
    render(<WorkspaceExitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /leave workspace/i }));
    await waitFor(() => expect(h.admin.leaveOrganization).toHaveBeenCalledWith('ns'));
    expect(h.confirms).toEqual(['Leave this workspace?', 'Leave the organization too?']);
    expect(h.clearNamespace).toHaveBeenCalled();
  });

  it('left Docs only, the last app: staying in the org leaves it alone', async () => {
    h.admin.leaveNamespace.mockResolvedValueOnce({ left: 'app', lastApp: true });
    h.answer = false;
    render(<WorkspaceExitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /leave workspace/i }));
    await waitFor(() => expect(h.clearNamespace).toHaveBeenCalled());
    expect(h.admin.leaveOrganization).not.toHaveBeenCalled();
  });

  it('left the organization (open and legacy orgs): nothing more is asked', async () => {
    h.admin.leaveNamespace.mockResolvedValueOnce({ left: 'org', lastApp: false });
    render(<WorkspaceExitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /leave workspace/i }));
    await waitFor(() => expect(h.clearNamespace).toHaveBeenCalled());
    expect(h.confirms).toEqual(['Leave this workspace?']);
  });

  it('keeps the workspace selected and says why when the delete is refused', async () => {
    h.caps = { caps: 0xffffffff, isAdmin: true };
    h.admin.deleteNamespace.mockRejectedValueOnce(new Error('permission denied'));
    render(<WorkspaceExitPanel />);
    fireEvent.click(screen.getByRole('button', { name: /delete workspace/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/permission denied/);
    expect(h.clearNamespace).not.toHaveBeenCalled();
  });

  it('offers nothing while the role is still loading', () => {
    h.caps = { caps: null, isAdmin: false };
    render(<WorkspaceExitPanel />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
