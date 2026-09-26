import React from 'react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { WorkspaceSettingsPanel } from '../WorkspaceSettingsPanel';

const OWNER = 'o'.repeat(64);
const NAMED = 'a'.repeat(64);
const UNNAMED = 'b'.repeat(64);
const PICKED = 'c'.repeat(64);
const SELF = 'd'.repeat(64);

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'ns',
    rootGroupId: 'ns',
    registryClient: {},
    registryContextId: 'ctx',
    registryDuplicates: [],
    // SELF is deliberately stale here vs. the per-member metadata fetch
    // below, to catch anything that reads this map without also checking
    // the fresher per-member name (the fresh name must win, as it does
    // for the visible <MemberLabel>).
    namespaceMemberNames: { [NAMED]: 'Dana', [PICKED]: 'Carol', [SELF]: 'Old Self Name' },
  }),
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: (_ns: unknown, memberId: string | null | undefined) => ({
    name: memberId === SELF ? 'Fresh Self Name' : null,
  }),
}));
vi.mock('@/hooks/useNamespacePermissions', () => ({
  useNamespacePermissions: () => ({ canManageNamespace: true }),
}));
const registryAdmin = {
  owner: OWNER,
  isOwner: true,
  managers: [NAMED, UNNAMED],
  loading: false,
  error: null as Error | null,
};
vi.mock('@/hooks/useRegistryAdmin', () => ({
  useRegistryAdmin: () => registryAdmin,
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => async () => false,
}));
vi.mock('@/components/common/MemberPicker', () => ({
  MemberPicker: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <button type="button" onClick={() => onSelect(PICKED)}>
      Pick member
    </button>
  ),
}));

describe('WorkspaceSettingsPanel managers', () => {
  afterEach(() => {
    registryAdmin.error = null;
    registryAdmin.managers = [NAMED, UNNAMED];
  });

  it('shows plain copy, not the raw error, when roles fail to load', () => {
    registryAdmin.error = new Error('registry context has no owned identity');
    render(<WorkspaceSettingsPanel />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe("Couldn't load roles. Try refreshing the page.");
  });

  it('names each remove button by display name or the shared fallback', () => {
    render(<WorkspaceSettingsPanel />);
    expect(screen.getByRole('button', { name: 'Remove manager Dana' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'Remove manager Unnamed member' }),
    ).toBeTruthy();
  });

  it('names the remove button by the same fresh name shown on the row', () => {
    registryAdmin.managers = [NAMED, UNNAMED, SELF];
    render(<WorkspaceSettingsPanel />);
    expect(
      screen.getByRole('button', { name: 'Remove manager Fresh Self Name' }),
    ).toBeTruthy();
    expect(screen.getByText('Fresh Self Name')).toBeTruthy();
  });

  it('echoes a picked member by name, not by key', () => {
    render(<WorkspaceSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick member' }));
    expect(screen.getByText('Carol')).toBeTruthy();
    expect(screen.queryByText(new RegExp(PICKED.slice(0, 16)))).toBeNull();
  });
});
