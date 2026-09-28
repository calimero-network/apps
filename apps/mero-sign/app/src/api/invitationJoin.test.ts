import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeroJs } from '@calimero-network/mero-js';
import { shouldRetain } from '@calimero-apps/invite';

import { setMeroInstance } from '../lib/node';
import { encodeInvite } from '../lib/inviteCodec';
import {
  InvitationRedeemError,
  joinWorkspaceFromInvitation,
} from './invitationJoin';

// ── Redeeming an open invitation: did we join, and is the link worth keeping ──
//
// The workspace join goes through `@calimero-apps/invite`'s `redeemInvitation`,
// which decides by membership rather than by the request resolving. What these
// pin is the app's side of that: the node's status reaches the classifier
// through `lib/node`'s `{data, error}` shim, and the error the popup catches
// says whether the invitation is finished with and whether "Try again" means
// anything.

// No agreement in the workspace, so the flow stops at "you are in the
// workspace" — the post-join steps are not what is under test here.
vi.mock('../lib/agreements', () => ({
  listAgreements: vi.fn(async () => []),
  pickInvitedAgreement: vi.fn(() => null),
  enterAgreement: vi.fn(),
}));
vi.mock('../lib/activeWorkspace', () => ({ setActiveWorkspace: vi.fn() }));
vi.mock('@calimero-apps/join-sync', () => ({
  markNamespaceJustJoined: vi.fn(),
}));

const NAMESPACE_ID = 'ab'.repeat(32);

const raw = encodeInvite({
  invitation: {
    invitation: { group_id: NAMESPACE_ID, invited_role: 0 },
    inviterSignature: 'ff'.repeat(64),
  },
  workspaceName: 'Acme',
});

/** A node error the way mero-js throws one: an Error with `status`. */
function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

function node(opts: {
  join: (namespaceId: string, body: unknown) => Promise<unknown>;
  namespaces?: string[];
}) {
  const joinNamespace = vi.fn(opts.join);
  const mero = {
    admin: {
      joinNamespace,
      listNamespaces: vi.fn(async () =>
        (opts.namespaces ?? []).map((namespaceId) => ({ namespaceId })),
      ),
    },
  } as unknown as MeroJs;
  setMeroInstance(mero);
  return { joinNamespace };
}

async function failure(): Promise<InvitationRedeemError> {
  const err = await joinWorkspaceFromInvitation(raw, {}).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(InvitationRedeemError);
  return err as InvitationRedeemError;
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  setMeroInstance(null);
  vi.restoreAllMocks();
});

describe('joinWorkspaceFromInvitation', () => {
  it('joins the workspace the signed body names, once', async () => {
    const { joinNamespace } = node({
      join: async () => ({
        namespaceId: NAMESPACE_ID,
        memberIdentity: 'id-1',
        memberAccount: 'acct-1',
        groupName: 'Acme Legal',
      }),
    });

    const result = await joinWorkspaceFromInvitation(raw, {});

    expect(joinNamespace).toHaveBeenCalledTimes(1);
    expect(joinNamespace.mock.calls[0][0]).toBe(NAMESPACE_ID);
    expect(result).toMatchObject({
      namespaceId: NAMESPACE_ID,
      contextId: null,
      workspaceName: 'Acme Legal',
    });
  });

  it('treats a failed request for a namespace now listed as already joined', async () => {
    // The desktop proxy aborts at 30s; the join lands anyway.
    const { joinNamespace } = node({
      join: async () => {
        throw httpError(504, 'Gateway Timeout');
      },
      namespaces: [NAMESPACE_ID],
    });

    const result = await joinWorkspaceFromInvitation(raw, {});

    expect(joinNamespace).toHaveBeenCalledTimes(1);
    // No answer from the join, so the name comes from the invitation.
    expect(result).toMatchObject({
      namespaceId: NAMESPACE_ID,
      workspaceName: 'Acme',
    });
  });

  it('reports a 409 as final: friendly copy, no retry, not kept', async () => {
    node({
      join: async () => {
        throw httpError(409, 'member was removed from this group');
      },
    });

    const err = await failure();

    expect(err.outcome.reason).toBe('refused');
    expect(err.outcome.retryable).toBe(false);
    expect(shouldRetain(err.outcome)).toBe(false);
    expect(err.message).toBe(
      "You can't join this workspace with this invitation. Ask an admin to invite you again.",
    );
  });

  it('reports a 503 as transient: kept, retry offered', async () => {
    node({
      join: async () => {
        throw httpError(503, 'no peers available');
      },
    });

    const err = await failure();

    expect(err.outcome.reason).toBe('no-one-online');
    expect(err.outcome.retryable).toBe(true);
    expect(shouldRetain(err.outcome)).toBe(true);
    expect(err.message).toMatch(/No one in this workspace is online/);
  });

  it('shows the node’s own words when nothing more specific is known', async () => {
    node({
      join: async () => {
        throw new Error('something odd happened');
      },
    });

    const err = await failure();

    expect(err.outcome.reason).toBe('unknown');
    expect(err.message).toBe('something odd happened');
  });
});
