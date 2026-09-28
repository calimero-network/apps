import { HTTPError } from '@calimero-network/mero-js';
import { shouldRetain, type RedeemOutcome } from '@calimero-apps/invite';
import { describe, expect, it, vi } from 'vitest';
import type { ParsedInvite } from '@/hooks/useNamespaceInvitation';
import {
  inviteFailureCopy,
  redeemInvite,
  type InviteCalls,
} from '../redeemInvite';

const httpError = (status: number, message: string) =>
  Object.assign(
    new HTTPError(status, message, 'http://node/admin-api', new Headers()),
    {
      message,
    },
  );

const INV = {
  inviter_signature: 'sig',
} as unknown as ParsedInvite['invitation'];

const workspace: ParsedInvite = {
  kind: 'namespace',
  targetId: 'ns1',
  invitation: INV,
  targetName: 'Acme',
};
const folder: ParsedInvite = { ...workspace, kind: 'group', targetId: 'g1' };

function calls(overrides: Partial<InviteCalls> = {}) {
  return {
    joinNamespace: vi.fn<InviteCalls['joinNamespace']>(() => Promise.resolve()),
    joinFolder: vi.fn<InviteCalls['joinFolder']>(() => Promise.resolve()),
    listNamespaces: vi.fn<InviteCalls['listNamespaces']>(() =>
      Promise.resolve([]),
    ),
    ...overrides,
  };
}

function failed(outcome: RedeemOutcome) {
  if (outcome.status !== 'failed')
    throw new Error(`expected a failure, got ${outcome.status}`);
  return outcome;
}

describe('redeemInvite', () => {
  it('reports a clean join as joined, passing the name through', async () => {
    const c = calls();
    const outcome = await redeemInvite(workspace, c);
    expect(outcome.status).toBe('joined');
    expect(c.joinNamespace).toHaveBeenCalledOnce();
    expect(c.joinNamespace).toHaveBeenCalledWith('ns1', INV, 'Acme');
  });

  it('is already-member when the request failed but the node lists the workspace', async () => {
    // The desktop proxy aborts at 30s; the join lands anyway. Sent once.
    const c = calls({
      joinNamespace: vi.fn(() =>
        Promise.reject(new Error('The request was aborted')),
      ),
      listNamespaces: vi.fn(() => Promise.resolve([{ namespaceId: 'ns1' }])),
    });
    const outcome = await redeemInvite(workspace, c);
    expect(outcome).toMatchObject({
      status: 'already-member',
      namespaceId: 'ns1',
    });
    expect(c.joinNamespace).toHaveBeenCalledOnce();
  });

  it('returns a 409 as a final failure with the workspace copy', async () => {
    const c = calls({
      joinNamespace: vi.fn(() =>
        Promise.reject(httpError(409, 'member was removed from the group')),
      ),
    });
    const outcome = failed(await redeemInvite(workspace, c));
    expect(outcome.reason).toBe('refused');
    expect(shouldRetain(outcome)).toBe(false);
    expect(inviteFailureCopy(outcome, 'workspace')).toBe(
      "You can't join this workspace with this invitation. Ask an admin to invite you again.",
    );
  });

  it('keeps a 503 for another attempt', async () => {
    const c = calls({
      joinNamespace: vi.fn(() =>
        Promise.reject(httpError(503, 'no peer available for key delivery')),
      ),
    });
    const outcome = failed(await redeemInvite(workspace, c));
    expect(outcome.reason).toBe('no-one-online');
    expect(shouldRetain(outcome)).toBe(true);
    expect(inviteFailureCopy(outcome, 'workspace')).toMatch(
      /No one in this workspace is online/,
    );
  });

  it("shows the node's own message when the reason is unknown", async () => {
    const c = calls({
      joinNamespace: vi.fn(() => Promise.reject(new Error('something odd'))),
    });
    const outcome = failed(await redeemInvite(workspace, c));
    expect(outcome.reason).toBe('unknown');
    expect(inviteFailureCopy(outcome, 'workspace')).toBe('something odd');
  });

  it('joins a folder through the folder call, never consulting the namespace list', async () => {
    const c = calls();
    const outcome = await redeemInvite(folder, c);
    expect(outcome.status).toBe('joined');
    expect(c.joinFolder).toHaveBeenCalledWith(INV, 'Acme');
    expect(c.joinNamespace).not.toHaveBeenCalled();
  });

  it('is already-member when the node says a folder join is a duplicate', async () => {
    const c = calls({
      joinFolder: vi.fn(() =>
        Promise.reject(new Error('identity is already a member of this group')),
      ),
    });
    expect((await redeemInvite(folder, c)).status).toBe('already-member');
  });

  it('does not read an unrelated "already" as membership', async () => {
    const c = calls({
      joinFolder: vi.fn(() =>
        Promise.reject(new Error('folder is already at member capacity')),
      ),
    });
    const outcome = failed(await redeemInvite(folder, c));
    expect(inviteFailureCopy(outcome, 'folder')).toBe(
      'folder is already at member capacity',
    );
    expect(c.listNamespaces).not.toHaveBeenCalled();
  });
});
