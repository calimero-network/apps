// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// ── An account's application id, before and after the registry answers ─────
//
// On an account the provider learns the id from the registry AFTER sign-in has
// settled, so the first signed-in renders have none. That is "still asking":
// answered instead, the workspaces screen showed "No workspaces yet" and its
// resume gave up on the workspace open last before the id ever arrived.

const session = vi.hoisted(() => ({
  isDelegated: true,
  applicationId: null as string | null,
}));
vi.mock('@calimero-network/mero-react', () => ({ useMero: () => session }));
const app = {};
vi.mock('../lib/useCalimero', () => ({ useCalimero: () => ({ app }) }));
vi.mock('../lib/node', () => ({ apiClient: { node: vi.fn() } }));

const { useApplicationId } = await import('./useApplicationId');

describe('useApplicationId on an account', () => {
  it('is loading until the provider has the id, then answers with it', () => {
    session.applicationId = null;
    const { result, rerender } = renderHook(() => useApplicationId());
    expect(result.current).toMatchObject({
      applicationId: null,
      loading: true,
      notInstalled: false,
      error: null,
    });

    session.applicationId = 'app-1';
    rerender();
    expect(result.current).toMatchObject({
      applicationId: 'app-1',
      loading: false,
      notInstalled: false,
      error: null,
    });
  });
});
