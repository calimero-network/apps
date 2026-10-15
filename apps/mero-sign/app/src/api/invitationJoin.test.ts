import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SignClient } from '../lib/node';
import { shouldRetain } from '@calimero-network/mero-react';

import { setMeroInstance } from '../lib/node';
import { encodeInvite } from '../lib/inviteCodec';
import {
  enterAgreement,
  listAgreements,
  type AgreementRow,
} from '../lib/agreements';
import {
  InvitationRedeemError,
  joinWorkspaceFromInvitation,
} from './invitationJoin';

// ── Redeeming an open invitation: did we join, and is the link worth keeping ──
//
// The workspace join goes through mero-react's `redeemInvitation` (mero-js's),
// which decides by membership rather than by the request resolving. What these
// pin is the app's side of that: the node's status reaches the classifier
// through `lib/node`'s `{data, error}` shim, and the error the invitation
// dialog's redeem catches says whether the invitation is finished with and
// whether "Try again" means anything.

// The workspace's listing is scripted per test; choosing among it is the real
// rule. Entering, and everything after it, is the node's business and is
// stubbed to succeed — what is under test is WHICH agreement is entered.
vi.mock('../lib/agreements', async (importOriginal) => ({
  pickInvitedAgreement: (
    await importOriginal<typeof import('../lib/agreements')>()
  ).pickInvitedAgreement,
  listAgreements: vi.fn(),
  enterAgreement: vi.fn(),
}));
vi.mock('./dataSource/ClientApiDataSource', () => ({
  ClientApiDataSource: class {
    getContextDetails = async () => ({ data: { context_name: 'Lease' } });
    registerSelfAsParticipant = async () => ({});
    joinSharedContext = async () => ({});
  },
}));
vi.mock('./defaultContextService', () => ({
  DefaultContextService: {
    getInstance: () => ({
      ensureDefaultContext: async () => ({ success: false }),
    }),
  },
}));
vi.mock('../lib/activeWorkspace', () => ({ setActiveWorkspace: vi.fn() }));
vi.mock('@calimero-network/mero-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  markNamespaceJustJoined: vi.fn(),
}));

const NAMESPACE_ID = 'ab'.repeat(32);

const LEASE_CONTEXT = 'cd'.repeat(32);

/** An open invitation to the workspace, naming one of its agreements or none. */
function inviteFor(contextId?: string): string {
  return encodeInvite({
    invitation: {
      invitation: {
        group_id: NAMESPACE_ID,
        invited_role: 0,
        ...(contextId ? { context_id: contextId } : {}),
      },
      inviterSignature: 'ff'.repeat(64),
    },
    workspaceName: 'Acme',
  });
}

const raw = inviteFor();

function agreement(
  agreementId: string,
  contextId: string | null,
): AgreementRow {
  return {
    agreementId,
    name: agreementId,
    contextId,
    memberCount: 1,
    teeMode: null,
    joined: false,
    identity: null,
  };
}

/**
 * Redeem with the clock running fast. Past the join, the agreements may still
 * be replicating and the redemption waits for them; the test does not.
 */
async function redeem(token = raw) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const done = joinWorkspaceFromInvitation(token, {});
  await vi.advanceTimersByTimeAsync(120_000);
  return done;
}

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
  } as unknown as SignClient;
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
  // `settleIntoAgreement` records the agreement in storage; this suite runs in
  // node, which has none.
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  vi.mocked(listAgreements).mockReset().mockResolvedValue([]);
  vi.mocked(enterAgreement).mockReset().mockResolvedValue('member-1');
});

afterEach(() => {
  setMeroInstance(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
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

    const result = await redeem();

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

    const result = await redeem();

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

// ── Finding the agreement inside the workspace, right after joining it ──────
//
// The namespace join returns before its subgroups have replicated, so the
// first listing is routinely empty. Taking that as the answer put the person
// on the workspace screen and never into the agreement they were invited to
// sign.

describe('the agreement an invitation lands you in', () => {
  function joinedNode() {
    node({
      join: async () => ({
        namespaceId: NAMESPACE_ID,
        memberIdentity: 'id-1',
        memberAccount: 'acct-1',
        groupName: 'Acme Legal',
      }),
    });
  }

  it('enters the agreement the link names once it replicates', async () => {
    joinedNode();
    vi.mocked(listAgreements)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('Uninitialized'))
      .mockResolvedValue([agreement('sg-lease', LEASE_CONTEXT)]);

    const result = await redeem(inviteFor(LEASE_CONTEXT));

    expect(result.contextId).toBe(LEASE_CONTEXT);
    expect(enterAgreement).toHaveBeenCalledWith(expect.anything(), {
      namespaceId: NAMESPACE_ID,
      agreementId: 'sg-lease',
      contextId: LEASE_CONTEXT,
    });
  });

  it('waits for the named agreement rather than entering another one', async () => {
    joinedNode();
    vi.mocked(listAgreements)
      .mockResolvedValueOnce([agreement('sg-other', 'ef'.repeat(32))])
      .mockResolvedValue([
        agreement('sg-other', 'ef'.repeat(32)),
        agreement('sg-lease', LEASE_CONTEXT),
      ]);

    const result = await redeem(inviteFor(LEASE_CONTEXT));

    expect(result.contextId).toBe(LEASE_CONTEXT);
  });

  it('lands on the workspace when the named agreement never arrives', async () => {
    joinedNode();

    const result = await redeem(inviteFor(LEASE_CONTEXT));

    expect(result).toMatchObject({
      namespaceId: NAMESPACE_ID,
      contextId: null,
    });
    expect(enterAgreement).not.toHaveBeenCalled();
    // Kept asking, rather than concluding on the first look.
    expect(vi.mocked(listAgreements).mock.calls.length).toBeGreaterThan(1);
  });

  it('naming none, does not take a first empty listing as the answer', async () => {
    joinedNode();
    vi.mocked(listAgreements)
      .mockResolvedValueOnce([])
      .mockResolvedValue([agreement('sg-lease', LEASE_CONTEXT)]);

    const result = await redeem();

    expect(result.contextId).toBe(LEASE_CONTEXT);
  });

  it('naming none, waits for an agreement whose context has not replicated', async () => {
    joinedNode();
    vi.mocked(listAgreements)
      .mockResolvedValueOnce([agreement('sg-lease', null)])
      .mockResolvedValue([agreement('sg-lease', LEASE_CONTEXT)]);

    const result = await redeem();

    expect(result.contextId).toBe(LEASE_CONTEXT);
  });
});
