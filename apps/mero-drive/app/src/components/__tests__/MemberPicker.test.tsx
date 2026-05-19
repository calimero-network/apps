import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemberPicker } from '../common/MemberPicker';

const members = [
  {
    identity: 'alice-pubkey-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    role: 'Member',
  },
  {
    identity: 'bob-pubkey-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    role: 'Member',
  },
  {
    identity: 'cathy-pubkey-cccccccccccccccccccccccccccccccccc',
    role: 'Member',
  },
];
const useGroupMembersMock = vi.fn();
vi.mock('@calimero-network/mero-react', () => ({
  useGroupMembers: (...a: unknown[]) => useGroupMembersMock(...a),
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: (_ns: string, mid: string) => ({
    name: mid.startsWith('alice') ? 'Alice' : null,
    loading: false,
    error: null,
    setName: async () => {},
    refetch: async () => {},
  }),
}));
vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ rootGroupId: 'root', selfIdentity: 'self' }),
}));

beforeEach(() =>
  useGroupMembersMock.mockReturnValue({
    members,
    selfIdentity: 'self',
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
);

describe('MemberPicker', () => {
  it('renders nothing in the dropdown until input is focused', () => {
    const onSelect = vi.fn();
    render(<MemberPicker namespaceId="ns" onSelect={onSelect} />);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows all members when focused with empty query', () => {
    render(<MemberPicker namespaceId="ns" onSelect={vi.fn()} />);
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option')).toHaveLength(3);
  });

  it('filters by display name (case-insensitive)', () => {
    render(<MemberPicker namespaceId="ns" onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'ali' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByText('Alice')).toBeTruthy();
  });

  it('filters by pubkey prefix', () => {
    render(<MemberPicker namespaceId="ns" onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'bob-pubkey' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
  });

  it('excludes identities passed in `exclude`', () => {
    render(
      <MemberPicker
        namespaceId="ns"
        exclude={[members[0].identity]}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.focus(screen.getByRole('combobox'));
    expect(screen.getAllByRole('option')).toHaveLength(2);
  });

  it('clicking an option calls onSelect with the identity and closes the dropdown', () => {
    const onSelect = vi.fn();
    render(<MemberPicker namespaceId="ns" onSelect={onSelect} />);
    fireEvent.focus(screen.getByRole('combobox'));
    // We use onMouseDown (not onClick) on the option button so it fires
    // before the input's blur tears down the dropdown.
    fireEvent.mouseDown(screen.getByText('Alice'));
    expect(onSelect).toHaveBeenCalledWith(members[0].identity);
  });

  it('accepts a free-form pubkey paste via Enter when no option matches', () => {
    const onSelect = vi.fn();
    render(<MemberPicker namespaceId="ns" onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    fireEvent.focus(input);
    const paste = 'unknown-pubkey-zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz';
    fireEvent.change(input, { target: { value: paste } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(paste);
  });
});
