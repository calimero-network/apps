// @vitest-environment jsdom
/**
 * Removing a member from the Members page.
 *
 * The page had a role control and no way at all to take someone out of a
 * workspace. The behaviour pinned here: Remove asks first, addresses the
 * member by ACCOUNT (the roster's key, never an executor key), and is never
 * offered on your own row or on the workspace's only admin.
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

const removeMember = vi.fn(async () => {});
let roles: Map<string, string>;
let canManageMembers = true;

vi.mock('./appContext', () => ({
  useAppCtx: () => ({
    members: Array.from(roles.keys()),
    aliases: {
      loaded: true,
      hasAlias: () => true,
      resolve: (id: string) => (id === BOB ? 'Bob' : 'Me'),
      setAlias: vi.fn(),
    },
    openInvite: vi.fn(),
    ws: {
      selfIdentity: ME,
      activeNs: 'ns-1',
      teeMode: null,
      roles: {
        roles,
        overrides: new Map(),
        defaultCapabilities: 0,
        canManageMembers,
        refetch: vi.fn(async () => {}),
        setRole: vi.fn(),
        setCapabilities: vi.fn(),
        removeMember,
        repairDefaultCapabilities: vi.fn(),
      },
    },
  }),
}));

const MembersPage = (await import('./MembersPage')).default;

function rowOf(account: string): HTMLElement {
  const row = screen.getAllByTestId('member-row').find((r) => r.dataset.account === account);
  if (!row) throw new Error(`no row for ${account}`);
  return row;
}

afterEach(() => {
  cleanup();
  removeMember.mockClear();
  canManageMembers = true;
});

describe('MembersPage removal', () => {
  it('removes a member by account, only after confirming', async () => {
    roles = new Map([[ME, 'Admin'], [BOB, 'Member']]);
    render(createElement(MembersPage));

    fireEvent.click(within(rowOf(BOB)).getByLabelText('Remove Bob'));
    expect(removeMember).not.toHaveBeenCalled();
    fireEvent.click(within(rowOf(BOB)).getByText('Remove'));
    await waitFor(() => expect(removeMember).toHaveBeenCalledWith(BOB));
  });

  it('never offers to remove yourself', () => {
    roles = new Map([[ME, 'Admin'], [BOB, 'Member']]);
    render(createElement(MembersPage));
    expect(within(rowOf(ME)).queryByText('Remove')).toBeNull();
  });

  it('offers nothing on the only admin, even to someone who manages members', () => {
    roles = new Map([[ME, 'Member'], [BOB, 'Admin']]);
    render(createElement(MembersPage));
    expect(within(rowOf(BOB)).queryByText('Remove')).toBeNull();
    // The role control is locked too: demoting them would leave no admin.
    expect(within(rowOf(BOB)).queryByTestId('member-role-select')).toBeNull();
    expect(within(rowOf(BOB)).getByTestId('member-role-badge').getAttribute('title')).toMatch(/only admin/i);
  });

  it('shows the list read-only to someone who cannot manage members', () => {
    canManageMembers = false;
    roles = new Map([[ME, 'Member'], [BOB, 'Member']]);
    render(createElement(MembersPage));
    expect(screen.queryByText('Remove')).toBeNull();
  });
});
