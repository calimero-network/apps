import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useFolderPermissions } from '../useFolderPermissions';
import { CAP } from '../../constants/config';
import { adminRequest } from '../../api/adminApi';

vi.mock('../useSelfIdentity', () => ({
  useSelfIdentity: () => ({ identity: 'me', loading: false, error: null }),
}));
vi.mock('../../api/adminApi', () => ({ adminRequest: vi.fn() }));

describe('useFolderPermissions', () => {
  const render = (caps: number) => {
    (adminRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ capabilities: caps });
    return renderHook(() => useFolderPermissions('ns', 'folder-1'));
  };

  it('READ permits canRead only', async () => {
    const { result } = render(CAP.READ);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.canRead).toBe(true);
    expect(result.current.canWrite).toBe(false);
  });

  it('WRITE permits write, not delete', async () => {
    const { result } = render(CAP.READ | CAP.WRITE);
    await waitFor(() => expect(result.current.canWrite).toBe(true));
    expect(result.current.canDelete).toBe(false);
  });

  it('MANAGE_GROUP permits delete + rename + visibility', async () => {
    const { result } = render(CAP.MANAGE_GROUP);
    await waitFor(() => expect(result.current.canDelete).toBe(true));
    expect(result.current.canRename).toBe(true);
    expect(result.current.canManageGroup).toBe(true);
  });
});
