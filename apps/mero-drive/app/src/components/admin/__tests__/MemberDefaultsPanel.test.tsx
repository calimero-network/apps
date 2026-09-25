// "Apply to existing members" overwrites every member's permissions with
// one click. These confirm the confirm dialog actually gates that sweep.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemberDefaultsPanel } from '../MemberDefaultsPanel';

const setMemberCapabilitiesMock = vi.fn().mockResolvedValue(undefined);
const refetchMembershipMock = vi.fn().mockResolvedValue(undefined);
const confirmMock = vi.fn();

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ namespaceId: 'ns-1', rootGroupId: 'root-1' }),
}));
vi.mock('@/hooks/useNamespacePermissions', () => ({
  useNamespacePermissions: () => ({ canManageNamespace: true }),
}));
vi.mock('@/hooks/useFolderMembership', () => ({
  useFolderMembership: () => ({
    members: [
      { identity: 'alice', role: 'Member', name: 'Alice' },
      { identity: 'bob', role: 'Member', name: 'Bob' },
    ],
    loading: false,
    error: null,
    add: vi.fn(),
    remove: vi.fn(),
    refetch: refetchMembershipMock,
  }),
}));
vi.mock('@calimero-network/mero-react', () => ({
  useDefaultCapabilities: () => ({
    defaultCapabilities: 37,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSetDefaultCapabilities: () => ({
    setDefaultCapabilities: vi.fn(),
    loading: false,
    error: null,
  }),
  useMero: () => ({
    mero: { admin: { setMemberCapabilities: setMemberCapabilitiesMock } },
  }),
}));
vi.mock('@/components/ui/confirm-dialog', () => ({
  useConfirm: () => confirmMock,
}));

describe('MemberDefaultsPanel apply-to-existing confirmation', () => {
  beforeEach(() => {
    setMemberCapabilitiesMock.mockClear();
    refetchMembershipMock.mockClear();
    confirmMock.mockReset();
  });

  it('cancelling the confirm leaves member capabilities untouched', async () => {
    confirmMock.mockResolvedValue(false);
    render(<MemberDefaultsPanel />);
    fireEvent.click(
      screen.getByRole('button', { name: /Apply to existing members/ }),
    );
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(setMemberCapabilitiesMock).not.toHaveBeenCalled();
  });

  it('confirming applies the defaults once', async () => {
    confirmMock.mockResolvedValue(true);
    render(<MemberDefaultsPanel />);
    fireEvent.click(
      screen.getByRole('button', { name: /Apply to existing members/ }),
    );
    await waitFor(() =>
      expect(setMemberCapabilitiesMock).toHaveBeenCalledTimes(2),
    );
    expect(confirmMock).toHaveBeenCalledTimes(1);
  });
});
