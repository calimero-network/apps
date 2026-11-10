// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PeoplePanel, { peopleRows, rowName } from './PeoplePanel';
import type { Member } from '../hooks/useSpreadsheet';

const member = (id: string, account: string) => ({ id, account, role: 'editor', nickname: '' }) as unknown as Member;

describe('peopleRows', () => {
  it('matches workbook members to the org roster, then lists who has not opened it', () => {
    const group = [
      { identity: 'acc-ann', role: 'admin' },
      { identity: 'acc-bob', role: 'member' },
    ];
    const { rows } = peopleRows([member('m-ann', 'acc-ann')], group);
    expect(rows.map((r) => r.key)).toEqual(['m-ann', 'acc-bob']);
    expect(rows[0].person?.identity).toBe('acc-ann');
    expect(rows[1].member).toBeNull();
  });
});

// A workspace member who has not opened this workbook used to be listed as
// `5926f2d2…` even when they had a workspace name.
describe('rowName', () => {
  const names: Record<string, string> = { 'acc-bob': 'Bob', 'm-ann': 'Ann' };
  const nameOf = (id: string) => names[id] ?? `${id}?`;

  it('names a group person who has not opened the workbook by their account', () => {
    const { rows } = peopleRows([], [{ identity: 'acc-bob', role: 'member' }]);
    expect(rowName(rows[0], nameOf)).toBe('Bob');
  });

  it('names a workbook member by their member id', () => {
    const { rows } = peopleRows([member('m-ann', 'acc-ann')], [{ identity: 'acc-ann', role: 'admin' }]);
    expect(rowName(rows[0], nameOf)).toBe('Ann');
  });
});

describe('PeoplePanel', () => {
  afterEach(() => cleanup());
  const panel = (selfId: string | null) =>
    render(
      createElement(PeoplePanel, {
        members: [member('acc-ann', 'acc-ann')],
        group: [{ identity: 'acc-ann', role: 'owner' }, { identity: 'acc-bob', role: 'member' }],
        selfId,
        workspaceName: 'Team',
        nameOf: (id: string) => id,
        canManageRoles: false,
        isGroupAdmin: true,
        onSetRole: vi.fn(),
        onSetGroupRole: vi.fn(),
        onRemove: vi.fn(),
        onClose: vi.fn(),
      }),
    );

  it('lets an admin remove a member, but never the org owner', () => {
    panel('acc-carl');
    expect(screen.getAllByTestId('action-remove-member')).toHaveLength(1);
  });

  const leaving = (props: { onLeave?: () => Promise<void>; appOnly?: boolean }) =>
    render(
      createElement(PeoplePanel, {
        members: [member('acc-ann', 'acc-ann')],
        group: [{ identity: 'acc-ann', role: 'member' }, { identity: 'acc-own', role: 'owner' }],
        selfId: 'acc-ann',
        workspaceName: 'Team',
        nameOf: (id: string) => id,
        canManageRoles: false,
        isGroupAdmin: false,
        onSetRole: vi.fn(),
        onSetGroupRole: vi.fn(),
        onRemove: vi.fn(),
        onClose: vi.fn(),
        ...props,
      }),
    );

  it('lets a member leave, only after confirming, and says the org stays when apps are kept apart', async () => {
    const onLeave = vi.fn(async () => {});
    leaving({ onLeave, appOnly: true });
    fireEvent.click(screen.getByTestId('action-leave-workspace'));
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog').textContent).toMatch(/stay in the organization and its other apps/);
    fireEvent.click(screen.getByTestId('action-confirm-leave'));
    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
  });

  it('offers no Leave without a handler (the owner)', () => {
    leaving({});
    expect(screen.queryByTestId('action-leave-workspace')).toBeNull();
  });
});
