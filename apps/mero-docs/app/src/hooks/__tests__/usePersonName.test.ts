import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { SELF_LABEL, usePersonName } from '../usePersonName';
import { UNNAMED_MEMBER_LABEL } from '@/components/common/MemberLabel';

const metadataNames: Record<string, string> = { carol: 'Carol (profile)' };

vi.mock('@/hooks/useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({
    namespaceId: 'w1',
    selfIdentity: 'me',
    namespaceMemberNames: { alice: 'Alice', carol: 'Carol (list)' },
  }),
}));
vi.mock('@/hooks/useMemberDisplayName', () => ({
  useMemberDisplayName: (_ns: string, id: string | null) => ({
    name: (id && metadataNames[id]) ?? null,
  }),
}));

describe('usePersonName', () => {
  it('names the caller "You" and others from the member list', () => {
    const { result } = renderHook(() => usePersonName());
    expect(result.current('me')).toBe(SELF_LABEL);
    expect(result.current('alice')).toBe('Alice');
  });

  it('prefers the focused member\'s own display name', () => {
    const { result } = renderHook(() => usePersonName('carol'));
    expect(result.current('carol')).toBe('Carol (profile)');
  });

  it('never shows a key', () => {
    const { result } = renderHook(() => usePersonName('zed'));
    expect(result.current('zed')).toBe(UNNAMED_MEMBER_LABEL);
  });
});
