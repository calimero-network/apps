import { HTTPError } from '@calimero-network/mero-js';
import { shouldRetain, type RedeemOutcome } from '@calimero-network/mero-react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ParsedInvite } from '@/hooks/useNamespaceInvitation';
import {
  FOLDER_JOIN_MS,
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

  // Both are 409s, which read as a generic refusal; the node's message is
  // the only thing that says which one, and they need different people.
  it('names a spent link, from the node message, after the general line', async () => {
    const c = calls({
      joinNamespace: vi.fn(() =>
        Promise.reject(
          httpError(
            409,
            'identity ab has already used this invitation to join group cd; a new invitation is required',
          ),
        ),
      ),
    });
    const outcome = failed(await redeemInvite(workspace, c));
    expect(shouldRetain(outcome)).toBe(false);
    expect(inviteFailureCopy(outcome, 'workspace')).toBe(
      "You can't join this workspace with this invitation. Ask an admin to invite you again. You've already used this link. Ask for a new one.",
    );
  });

  it('names a removal, from the node message', async () => {
    const c = calls({
      joinNamespace: vi.fn(() =>
        Promise.reject(httpError(409, 'RemovedFromGroup { group_id: cd }')),
      ),
    });
    const outcome = failed(await redeemInvite(workspace, c));
    expect(inviteFailureCopy(outcome, 'workspace')).toMatch(
      /An admin removed you. Ask to be re-added\.$/,
    );
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
    vi.useFakeTimers();
    const c = calls({
      joinFolder: vi.fn(() =>
        Promise.reject(new Error('folder is already at member capacity')),
      ),
    });
    // An unknown refusal is retried like a not-synced one, until the deadline.
    const pending = redeemInvite(folder, c);
    await vi.advanceTimersByTimeAsync(FOLDER_JOIN_MS + 3_000);
    const outcome = failed(await pending);
    vi.useRealTimers();
    expect(inviteFailureCopy(outcome, 'folder')).toBe(
      'folder is already at member capacity',
    );
    expect(c.listNamespaces).not.toHaveBeenCalled();
  });

  // Right after the namespace join the node may not hold the folder subgroup
  // yet and refuses it. Tried once, that left a locked folder until a reload.
  describe('a folder the node has not synced yet', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    const notSynced = () => httpError(404, "group 'g1' not found");

    it('retries the folder join until the node accepts it', async () => {
      vi.useFakeTimers();
      const joinFolder = vi
        .fn<InviteCalls['joinFolder']>()
        .mockRejectedValueOnce(notSynced())
        .mockRejectedValueOnce(notSynced())
        .mockResolvedValue('g1');
      const pending = redeemInvite(folder, calls({ joinFolder }));
      await vi.advanceTimersByTimeAsync(6_000);
      expect((await pending).status).toBe('joined');
      expect(joinFolder).toHaveBeenCalledTimes(3);
    });

    it('fails retryable once the node has refused for the whole window', async () => {
      vi.useFakeTimers();
      const joinFolder = vi.fn<InviteCalls['joinFolder']>(() =>
        Promise.reject(notSynced()),
      );
      let settled = false;
      const pending = redeemInvite(folder, calls({ joinFolder })).finally(
        () => {
          settled = true;
        },
      );
      await vi.advanceTimersByTimeAsync(FOLDER_JOIN_MS - 3_000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(6_000);
      const outcome = failed(await pending);
      expect(outcome.retryable).toBe(true);
      expect(shouldRetain(outcome)).toBe(true);
      expect(joinFolder.mock.calls.length).toBeGreaterThan(20);
    });

    it('does not retry a final refusal', async () => {
      vi.useFakeTimers();
      const joinFolder = vi.fn<InviteCalls['joinFolder']>(() =>
        Promise.reject(httpError(409, 'invitation for group g1 expired at 1')),
      );
      const outcome = failed(await redeemInvite(folder, calls({ joinFolder })));
      expect(outcome.retryable).toBe(false);
      expect(joinFolder).toHaveBeenCalledOnce();
    });

    it('does not retry a final refusal the status does not mark', async () => {
      vi.useFakeTimers();
      const joinFolder = vi.fn<InviteCalls['joinFolder']>(() =>
        Promise.reject(new Error('invitation was revoked')),
      );
      const outcome = failed(await redeemInvite(folder, calls({ joinFolder })));
      expect(joinFolder).toHaveBeenCalledOnce();
      expect(outcome.status).toBe('failed');
    });
  });
});
