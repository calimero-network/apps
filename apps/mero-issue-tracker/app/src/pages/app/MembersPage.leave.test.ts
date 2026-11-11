// @vitest-environment jsdom
/**
 * Leaving the workspace from the Members page. Anyone but the owner may
 * leave; in an org that keeps its apps apart it is Mero Issue Tracker only, and the
 * organization is offered when that was the person's last app there.
 */
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withRoutes } from '@calimero-apps/connect/testing';

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

let roles: Map<string, string>;
let appOnly = false;
let lastAppAnswer = false;
const leaveWorkspace = vi.fn(async (alsoOrg: () => boolean) => {
  lastAppAnswer = alsoOrg();
  return { left: 'app' as const, lastApp: true };
});

vi.mock('./appContext', () => ({
  useAppCtx: () => ({
    members: Array.from(roles.keys()),
    aliases: { loaded: true, hasAlias: () => true, resolve: () => 'Someone', setAlias: vi.fn() },
    openInvite: vi.fn(),
    ws: {
      selfIdentity: ME,
      activeNs: 'ns-1',
      leaveWorkspace,
      roles: withRoutes({
        roles,
        orgRoles: roles,
        overrides: new Map(),
        defaultCapabilities: 0,
        canManageMembers: false,
        appOnly,
        refetch: vi.fn(async () => {}),
        setRole: vi.fn(),
        setCapabilities: vi.fn(),
        removeMember: vi.fn(),
        repairDefaultCapabilities: vi.fn(),
      }),
    },
  }),
}));

const MembersPage = (await import('./MembersPage')).default;

afterEach(() => {
  cleanup();
  leaveWorkspace.mockClear();
  vi.restoreAllMocks();
  appOnly = false;
  lastAppAnswer = false;
});

describe('MembersPage leave', () => {
  it('a member leaves after confirming; the organization is asked about separately', async () => {
    roles = new Map([[ME, 'member'], [BOB, 'owner']]);
    appOnly = true;
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(true);
    render(createElement(MembersPage));
    fireEvent.click(screen.getByTestId('leave-workspace-btn'));
    await waitFor(() => expect(leaveWorkspace).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0]![0]).toMatch(/stay in the organization and its other apps/);
    expect(confirm.mock.calls[1]![0]).toMatch(/last app in this organization/);
    expect(lastAppAnswer).toBe(true);
  });

  it('nothing happens when the first prompt is declined', () => {
    roles = new Map([[ME, 'member'], [BOB, 'owner']]);
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(createElement(MembersPage));
    fireEvent.click(screen.getByTestId('leave-workspace-btn'));
    expect(leaveWorkspace).not.toHaveBeenCalled();
  });

  it('the owner is not offered Leave', () => {
    roles = new Map([[ME, 'owner'], [BOB, 'member']]);
    render(createElement(MembersPage));
    expect(screen.queryByTestId('leave-workspace-btn')).toBeNull();
  });
});
