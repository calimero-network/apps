import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemberLabel } from '../common/MemberLabel';

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ namespaceMemberNames: {} }),
}));

vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: (_ns: string | null | undefined, mid: string) => {
    if (mid === 'alice-key') {
      return {
        name: 'Alice',
        loading: false,
        error: null,
        setName: async () => {},
      };
    }
    if (mid === 'loading-key') {
      return {
        name: null,
        loading: true,
        error: null,
        setName: async () => {},
      };
    }
    return {
      name: null,
      loading: false,
      error: null,
      setName: async () => {},
    };
  },
}));

describe('MemberLabel', () => {
  it('renders the display name when present', () => {
    render(<MemberLabel namespaceId="ns1" memberId="alice-key" />);
    expect(screen.getByText('Alice')).toBeTruthy();
  });

  it('falls back to truncated pubkey when no name', () => {
    render(
      <MemberLabel
        namespaceId="ns1"
        memberId="abcdef0123456789abcdef0123456789"
      />,
    );
    // default truncate is "first8…last4"
    expect(screen.getByText('abcdef01…6789')).toBeTruthy();
  });

  it('renders fallback while loading (no flash of name)', () => {
    render(<MemberLabel namespaceId="ns1" memberId="loading-key" />);
    // "loading-key" is 11 chars → returned verbatim by defaultTruncate.
    expect(screen.getByText('loading-key')).toBeTruthy();
  });

  it('uses provided fallback when given', () => {
    render(
      <MemberLabel
        namespaceId="ns1"
        memberId="x"
        fallback={(id) => `id:${id}`}
      />,
    );
    expect(screen.getByText('id:x')).toBeTruthy();
  });

  it('renders the (you) badge for self', () => {
    render(<MemberLabel namespaceId="ns1" memberId="alice-key" isSelf />);
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('(you)')).toBeTruthy();
  });
});
