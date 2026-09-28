import { describe, expect, it, vi } from 'vitest';
import { shouldRetain } from '@calimero-apps/invite';
import { lobbyJoinFailureMessage, redeemLobbyInvitation, type LobbyAdmin } from './redeemLobby';

const NS = 'ns-1';
const INVITATION = { invitation: { groupId: NS }, inviterSignature: 'sig' };

/** An error shaped like mero-js's HTTPError: the status is what decides. */
const httpError = (status: number, message: string) =>
  Object.assign(new Error(message), { status });

function fakeAdmin(
  join: () => Promise<unknown>,
  listed: string[] = [],
): LobbyAdmin & { joinNamespace: ReturnType<typeof vi.fn> } {
  return {
    joinNamespace: vi.fn(join),
    listNamespaces: vi.fn(async () => listed.map((namespaceId) => ({ namespaceId }))),
  } as unknown as LobbyAdmin & { joinNamespace: ReturnType<typeof vi.fn> };
}

async function failed(admin: LobbyAdmin) {
  const outcome = await redeemLobbyInvitation(admin, NS, INVITATION);
  if (outcome.status !== 'failed') throw new Error(`expected a failure, got ${outcome.status}`);
  return outcome;
}

describe('redeemLobbyInvitation', () => {
  it('reports a clean join as joined, sending the invitation and name as given', async () => {
    const admin = fakeAdmin(async () => ({ namespaceId: NS }), [NS]);
    const outcome = await redeemLobbyInvitation(admin, NS, INVITATION, 'Friday');
    expect(outcome.status).toBe('joined');
    expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
    expect(admin.joinNamespace).toHaveBeenCalledWith(NS, {
      invitation: INVITATION,
      groupName: 'Friday',
    });
  });

  it('is already-member when the request failed but the node lists the lobby', async () => {
    // The desktop proxy aborts at 30s; the join lands anyway. Sent once.
    const admin = fakeAdmin(() => Promise.reject(httpError(504, 'Gateway Timeout')), ['other', NS]);
    const outcome = await redeemLobbyInvitation(admin, NS, INVITATION);
    expect(outcome.status).toBe('already-member');
    expect(admin.joinNamespace).toHaveBeenCalledTimes(1);
  });

  it('returns a 409 as a final failure with the lobby copy', async () => {
    const outcome = await failed(
      fakeAdmin(() => Promise.reject(httpError(409, 'member was removed from the group'))),
    );
    expect(outcome.reason).toBe('refused');
    expect(shouldRetain(outcome)).toBe(false);
    expect(lobbyJoinFailureMessage(outcome)).toBe(
      "You can't join this lobby with this invitation. Ask an admin to invite you again.",
    );
  });

  it('keeps a 503 as worth trying again', async () => {
    const outcome = await failed(
      fakeAdmin(() => Promise.reject(httpError(503, 'no peer available for key delivery'))),
    );
    expect(outcome.reason).toBe('no-one-online');
    expect(shouldRetain(outcome)).toBe(true);
    expect(lobbyJoinFailureMessage(outcome)).toMatch(/No one in this lobby is online/);
  });

  it("falls back to the node's own message when the reason is unknown", async () => {
    const outcome = await failed(
      fakeAdmin(() => Promise.reject(httpError(500, 'something nobody has seen before'))),
    );
    expect(outcome.reason).toBe('unknown');
    expect(lobbyJoinFailureMessage(outcome)).toBe('something nobody has seen before');
  });
});
