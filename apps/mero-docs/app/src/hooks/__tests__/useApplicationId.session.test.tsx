// Which admin `useApplicationId` asks, and whether it asks at all.
//
// `GET /admin-api/applications` is a node-wide listing. On a delegated
// (account) session the relay refuses it to the account's token (403), and an
// account has no install of its own to find: its id is the registry's answer
// for this package, on `useMero().applicationId`. So the hook must take that
// id and never list; on a node it lists, through the session-aware `admin`.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
// `vi.mock` is hoisted above this import, so the hook sees the mocked provider.
import { clearApplicationIdCache, useApplicationId } from '../useApplicationId';

const h = vi.hoisted(() => ({
  listApplications: vi.fn(),
  rawListApplications: vi.fn(),
  isDelegated: false,
  applicationId: null as string | null,
}));

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({
    mero: { admin: { listApplications: h.rawListApplications } },
    admin: { listApplications: h.listApplications },
    isDelegated: h.isDelegated,
    applicationId: h.applicationId,
    nodeUrl: 'http://node',
  }),
}));

vi.mock('@/constants/config', () => ({ PACKAGE_NAME: 'com.calimero.mero-drive-docs' }));


afterEach(() => {
  clearApplicationIdCache();
  h.isDelegated = false;
  h.applicationId = null;
  h.listApplications.mockReset();
  h.rawListApplications.mockReset();
});

describe('useApplicationId by session', () => {
  it('on a node asks the session admin, not the raw client, and matches by package', async () => {
    h.listApplications.mockResolvedValue({
      apps: [{ id: 'other', package: 'com.example.other' }, { id: 'docs-1', package: 'com.calimero.mero-drive-docs' }],
    });
    const { result } = renderHook(() => useApplicationId());
    await waitFor(() => expect(result.current.resolving).toBe(false));
    expect(result.current.appId).toBe('docs-1');
    expect(h.listApplications).toHaveBeenCalledTimes(1);
    expect(h.rawListApplications).not.toHaveBeenCalled();
  });

  it('on a delegated session takes the registry id from the provider and lists nothing', async () => {
    h.isDelegated = true;
    h.applicationId = 'registry-docs';
    const { result } = renderHook(() => useApplicationId());
    expect(result.current).toEqual({
      appId: 'registry-docs',
      resolving: false,
      notInstalled: false,
      inconclusive: false,
    });
    await Promise.resolve();
    expect(h.listApplications).not.toHaveBeenCalled();
    expect(h.rawListApplications).not.toHaveBeenCalled();
  });

  it('on a delegated session without a resolved id is inconclusive, not "not installed"', () => {
    h.isDelegated = true;
    const { result } = renderHook(() => useApplicationId());
    expect(result.current.appId).toBe('');
    expect(result.current.notInstalled).toBe(false);
    expect(result.current.inconclusive).toBe(true);
    expect(h.listApplications).not.toHaveBeenCalled();
  });
});
