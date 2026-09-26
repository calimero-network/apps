// What a promotion actually WRITES.
//
// The failure these tests exist for is not an exception — it is a role change
// that succeeds and confers nothing, because the second and third writes it
// implies were never made. So every assertion here is about the calls that
// went out, in which system, with which arguments.
//
// ⚠️ Request bodies are asserted by exact KEY SET. Core rejects an unknown
// field for the whole call, and a containment assertion passes with a fatal
// key sitting next to the one it checked.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
// vitest hoists `vi.mock` above every import, so these can sit at the top and
// still resolve against the mocks declared below.
import { useGroupRoleAdmin } from '../useGroupRoleAdmin';
import { DEFAULT_NEW_MEMBER_CAPS } from '@/constants/config';


const updateMemberRole = vi.fn();
const setMemberCapabilities = vi.fn();
const addManager = vi.fn();
const removeManager = vi.fn();
const registryAdmin = {
  isOwner: true,
  addManager,
  removeManager,
};

vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({ mero: { admin: { setMemberCapabilities } } }),
  useUpdateMemberRole: () => ({
    updateMemberRole,
    loading: false,
    error: null,
  }),
}));
vi.mock('../useDriveWorkspace', () => ({
  useDriveWorkspace: () => ({ registryAdmin }),
}));

const ACCOUNT = 'a'.repeat(64);

beforeEach(() => {
  updateMemberRole.mockReset().mockResolvedValue(undefined);
  setMemberCapabilities.mockReset().mockResolvedValue(undefined);
  addManager.mockReset().mockResolvedValue(undefined);
  removeManager.mockReset().mockResolvedValue(undefined);
  registryAdmin.isOwner = true;
});

describe('promotion to Admin', () => {
  it('writes the core role with the exact request body core expects', async () => {
    const { result } = renderHook(() => useGroupRoleAdmin('ns-1', true));
    await act(async () => {
      await result.current.setRole(ACCOUNT, 'Admin', 0, 'Member');
    });
    const [groupId, identity, body] = updateMemberRole.mock.calls[0];
    expect(groupId).toBe('ns-1');
    expect(identity).toBe(ACCOUNT);
    expect(Object.keys(body)).toEqual(['role']);
    expect(body.role).toBe('Admin');
  });

  // The bitmask is not consulted for an Admin; writing one would leave an
  // over-granted mask behind after a later demotion.
  it('does not touch the capability bitmask', async () => {
    const { result } = renderHook(() => useGroupRoleAdmin('ns-1', true));
    await act(async () => {
      await result.current.setRole(ACCOUNT, 'Admin', 0, 'Member');
    });
    expect(setMemberCapabilities).not.toHaveBeenCalled();
  });

  // The point of the whole exercise: core admin is not registry admin, and a
  // promotion that stops at the first is an Admin this app's contract refuses.
  it('also appoints them a registry manager', async () => {
    const { result } = renderHook(() => useGroupRoleAdmin('ns-1', true));
    await act(async () => {
      await result.current.setRole(ACCOUNT, 'Admin', 0, 'Member');
    });
    expect(addManager).toHaveBeenCalledWith(ACCOUNT);
    expect(removeManager).not.toHaveBeenCalled();
  });

  it('reports — not throws — when the caller cannot appoint managers', async () => {
    registryAdmin.isOwner = false;
    const { result } = renderHook(() => useGroupRoleAdmin('ns-1', true));
    let out = { ok: false, warnings: [] as string[] };
    await act(async () => {
      out = await result.current.setRole(ACCOUNT, 'Admin', 0, 'Member');
    });
    expect(out.ok).toBe(true);
    expect(addManager).not.toHaveBeenCalled();
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toMatch(/owner/i);
  });

  it('reports a failed manager append without losing the role change', async () => {
    addManager.mockRejectedValue(new Error('Forbidden'));
    const { result } = renderHook(() => useGroupRoleAdmin('ns-1', true));
    let out = { ok: false, warnings: [] as string[] };
    await act(async () => {
      out = await result.current.setRole(ACCOUNT, 'Admin', 0, 'Member');
    });
    expect(out.ok).toBe(true);
    expect(out.warnings[0]).toMatch(/Forbidden/);
  });

  // A folder roster must not hand out a workspace-wide grant.
  it('leaves the registry alone when the roster is not the workspace', async () => {
    const { result } = renderHook(() => useGroupRoleAdmin('folder-1', false));
    await act(async () => {
      await result.current.setRole(ACCOUNT, 'Admin', 0, 'Member');
    });
    expect(addManager).not.toHaveBeenCalled();
  });
});

describe('demotion from Admin', () => {
  // The silent-strip bug: their stored bitmask is 0 because nothing needed to
  // set it while the admin short-circuit applied. Demote without seeding and
  // they can do literally nothing, with no error.
  it('seeds the Editor default so the demoted admin can still work', async () => {
    const { result } = renderHook(() => useGroupRoleAdmin('ns-1', true));
    await act(async () => {
      await result.current.setRole(ACCOUNT, 'Member', 0, 'Admin');
    });
    const [groupId, identity, body] = setMemberCapabilities.mock.calls[0];
    expect(groupId).toBe('ns-1');
    expect(identity).toBe(ACCOUNT);
    expect(Object.keys(body)).toEqual(['capabilities']);
    expect(body.capabilities).toBe(DEFAULT_NEW_MEMBER_CAPS);
  });

  it('revokes their registry manager grant', async () => {
    const { result } = renderHook(() => useGroupRoleAdmin('ns-1', true));
    await act(async () => {
      await result.current.setRole(ACCOUNT, 'Member', 0, 'Admin');
    });
    expect(removeManager).toHaveBeenCalledWith(ACCOUNT);
    expect(addManager).not.toHaveBeenCalled();
  });

  it('warns, rather than failing, when the caps write is refused', async () => {
    setMemberCapabilities.mockRejectedValue(new Error('nope'));
    const { result } = renderHook(() => useGroupRoleAdmin('ns-1', true));
    let out = { ok: false, warnings: [] as string[] };
    await act(async () => {
      out = await result.current.setRole(ACCOUNT, 'Member', 0, 'Admin');
    });
    expect(out.ok).toBe(true);
    expect(out.warnings.some((w) => /not be able to do anything/i.test(w))).toBe(
      true,
    );
  });
});

describe('demotion to ReadOnly', () => {
  // A ReadOnly member's bits are still read by the server, so the label is
  // only true once the mask is cleared.
  it('clears the bitmask', async () => {
    const { result } = renderHook(() => useGroupRoleAdmin('ns-1', true));
    await act(async () => {
      await result.current.setRole(
        ACCOUNT,
        'ReadOnly',
        DEFAULT_NEW_MEMBER_CAPS,
        'Member',
      );
    });
    expect(setMemberCapabilities.mock.calls[0][2]).toEqual({ capabilities: 0 });
  });

  it('does not touch the registry when Admin-ness did not change', async () => {
    const { result } = renderHook(() => useGroupRoleAdmin('ns-1', true));
    await act(async () => {
      await result.current.setRole(ACCOUNT, 'ReadOnly', 4, 'Member');
    });
    expect(addManager).not.toHaveBeenCalled();
    expect(removeManager).not.toHaveBeenCalled();
  });
});

describe('ordering and failure', () => {
  // If the role write fails, nothing it implies should be attempted — the
  // person's role did not move, so widening or narrowing anything else would
  // leave the two systems disagreeing.
  it('attempts nothing else when the role write fails', async () => {
    updateMemberRole.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useGroupRoleAdmin('ns-1', true));
    await act(async () => {
      await expect(
        result.current.setRole(ACCOUNT, 'Member', 0, 'Admin'),
      ).rejects.toThrow('boom');
    });
    expect(setMemberCapabilities).not.toHaveBeenCalled();
    expect(removeManager).not.toHaveBeenCalled();
  });

  it('re-selecting the same non-Admin role leaves a deliberate mask alone', async () => {
    const { result } = renderHook(() => useGroupRoleAdmin('ns-1', true));
    await act(async () => {
      await result.current.setRole(
        ACCOUNT,
        'Member',
        DEFAULT_NEW_MEMBER_CAPS,
        'ReadOnly',
      );
    });
    expect(setMemberCapabilities).not.toHaveBeenCalled();
  });
});
