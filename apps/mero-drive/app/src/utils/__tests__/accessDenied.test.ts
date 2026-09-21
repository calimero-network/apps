import { describe, it, expect, vi } from 'vitest';
import { isGroupAccessDenied } from '../accessDenied';

const internal = { status: 500, bodyText: '{"error":"Internal server error"}' };
const notMember = {
  status: 403,
  bodyText: `{"error":"node is not a member of group 'x'"}`,
};

describe('isGroupAccessDenied', () => {
  it('confirms a generic probe failure as a denial via the member list', async () => {
    const admin = { listGroupMembers: vi.fn().mockRejectedValue(notMember) };
    await expect(isGroupAccessDenied(admin, 'g', internal)).resolves.toBe(true);
    expect(admin.listGroupMembers).toHaveBeenCalledWith('g');
  });

  it('keeps a folder visible when the member list answers', async () => {
    const admin = { listGroupMembers: vi.fn().mockResolvedValue({ members: [] }) };
    await expect(isGroupAccessDenied(admin, 'g', internal)).resolves.toBe(false);
  });

  it('keeps a folder visible when both calls fail for another reason', async () => {
    const admin = { listGroupMembers: vi.fn().mockRejectedValue(internal) };
    await expect(isGroupAccessDenied(admin, 'g', internal)).resolves.toBe(false);
  });

  it('trusts a probe failure that already names the denial', async () => {
    const admin = { listGroupMembers: vi.fn() };
    await expect(isGroupAccessDenied(admin, 'g', notMember)).resolves.toBe(true);
    expect(admin.listGroupMembers).not.toHaveBeenCalled();
  });
});
