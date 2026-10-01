import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemberLabel, UNNAMED_MEMBER_LABEL } from '../common/MemberLabel';

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

  it('falls back to "Unnamed member" when no name resolves, never the raw key', () => {
    render(
      <MemberLabel
        namespaceId="ns1"
        memberId="abcdef0123456789abcdef0123456789"
      />,
    );
    expect(screen.getByText(UNNAMED_MEMBER_LABEL)).toBeTruthy();
    expect(screen.queryByText(/abcdef01/)).toBeNull();
  });

  it('keeps the full key reachable via the title tooltip, never as visible text', () => {
    render(<MemberLabel namespaceId="ns1" memberId="loading-key" />);
    expect(screen.getByText(UNNAMED_MEMBER_LABEL).title).toBe('loading-key');
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
