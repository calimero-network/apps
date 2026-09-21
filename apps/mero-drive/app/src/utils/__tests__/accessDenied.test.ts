import { describe, it, expect, vi } from 'vitest';
import { AuthRevokedError, HTTPError } from '@calimero-network/mero-js';
import { isGroupAccessDenied, lacksFolderAccess } from '../accessDenied';

const httpError = (status: number, body: string) =>
  new HTTPError(status, '', '/admin-api/groups/g', new Headers(), body);

const internal = httpError(500, '{"error":"Internal server error"}');
const denied = httpError(403, '{"error":"refused"}');

describe('isGroupAccessDenied', () => {
  it('confirms a failed probe as a denial when the member list answers 403', async () => {
    const admin = { listGroupMembers: vi.fn().mockRejectedValue(denied) };
    await expect(isGroupAccessDenied(admin, 'g', internal)).resolves.toBe(true);
    expect(admin.listGroupMembers).toHaveBeenCalledWith('g');
  });

  it('keeps a folder visible when the member list answers', async () => {
    const admin = {
      listGroupMembers: vi.fn().mockResolvedValue({ members: [] }),
    };
    await expect(isGroupAccessDenied(admin, 'g', internal)).resolves.toBe(
      false,
    );
  });

  it('keeps a folder visible on a 500 whose body reads like a denial', async () => {
    const admin = {
      listGroupMembers: vi
        .fn()
        .mockRejectedValue(
          httpError(500, '{"error":"forbidden: not a member"}'),
        ),
    };
    await expect(isGroupAccessDenied(admin, 'g', internal)).resolves.toBe(
      false,
    );
  });

  it('keeps a folder visible when the 403 is a revoked session', async () => {
    const revoked = new AuthRevokedError(
      'token_revoked',
      403,
      '',
      '/',
      new Headers(),
      '',
    );
    const admin = { listGroupMembers: vi.fn().mockRejectedValue(revoked) };
    await expect(isGroupAccessDenied(admin, 'g', internal)).resolves.toBe(
      false,
    );
  });

  it('trusts a probe that is itself refused with 403', async () => {
    const admin = { listGroupMembers: vi.fn() };
    await expect(isGroupAccessDenied(admin, 'g', denied)).resolves.toBe(true);
    expect(admin.listGroupMembers).not.toHaveBeenCalled();
  });
});

describe('lacksFolderAccess', () => {
  it('treats a 403 refusal as no access', () => {
    expect(
      lacksFolderAccess({ isMember: false, error: denied, denied: false }),
    ).toBe(true);
  });

  it('treats a 500 the caps hook classified as membership lag, then exhausted, as no access', () => {
    const error = httpError(500, '{"error":"identity is not a member"}');
    expect(lacksFolderAccess({ isMember: false, error, denied: true })).toBe(
      true,
    );
  });

  it('shows a 500 as an error even when its body reads like a denial', () => {
    const error = httpError(500, '{"error":"forbidden: not a member"}');
    expect(lacksFolderAccess({ isMember: false, error, denied: false })).toBe(
      false,
    );
  });

  it('treats a settled non-member as no access', () => {
    expect(
      lacksFolderAccess({ isMember: false, error: null, denied: false }),
    ).toBe(true);
  });

  it('grants a member', () => {
    expect(
      lacksFolderAccess({ isMember: true, error: null, denied: false }),
    ).toBe(false);
  });
});
