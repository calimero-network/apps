import { describe, expect, it } from 'vitest';
import type { MeroJs } from '@calimero-network/mero-js';

import { nodeApi } from './node';

// ── Redeeming an invitation, on the wire ────────────────────────────────────
//
// ⚠️ THE INVITATION IS A FIELD, NOT THE BODY. `JoinNamespaceRequest` is
// `{invitation, groupName?}`, and every core request body is
// `deny_unknown_fields` — so posting the bare `SignedGroupOpenInvitation`
// sends `{invitation: {…}, inviter_signature: …}` at the top level and the
// node refuses the whole call, naming `inviter_signature`. The two are easy to
// confuse precisely because the signed object has a field of its own called
// `invitation`, which is what the previous version passed.

const invitation = {
  invitation: { group_id: [1, 2, 3], invited_role: 0 },
  inviter_signature: 'ff'.repeat(64),
};

function fake() {
  const calls: { args: unknown[] }[] = [];
  const mero = {
    admin: {
      joinNamespace: (...args: unknown[]) => {
        calls.push({ args });
        return Promise.resolve({
          namespaceId: 'ns-acme',
          memberIdentity: 'id-1',
          memberAccount: 'acct-1',
        });
      },
    },
  } as unknown as MeroJs;
  return { calls, api: nodeApi(mero) };
}

describe('joining a workspace from an invitation', () => {
  it('wraps the invitation in the field the body declares', async () => {
    const { calls, api } = fake();
    await api.joinContextByOpenInvitation('ns-acme', invitation);
    // The KEY SET, not "contains": a surplus top-level key is as fatal as a
    // missing one against `deny_unknown_fields`.
    expect(Object.keys(calls[0].args[1] as object)).toEqual(['invitation']);
    expect((calls[0].args[1] as { invitation: unknown }).invitation).toEqual(
      invitation,
    );
  });

  it('sends the namespace in the path, not an empty string', async () => {
    // It used to send `''`, and the node has no namespace by that name.
    const { calls, api } = fake();
    await api.joinContextByOpenInvitation('ns-acme', invitation);
    expect(calls[0].args[0]).toBe('ns-acme');
  });

  it('answers with the namespace, and does NOT invent a context', async () => {
    // Joining a workspace is not joining the agreements inside it. Code that
    // reads `contextId` off this gets `undefined` and reports "the node did
    // not say which context it joined" — which is true, and not a node bug.
    const { api } = fake();
    const res = await api.joinContextByOpenInvitation('ns-acme', invitation);
    expect(res.data?.namespaceId).toBe('ns-acme');
    expect(res.data).not.toHaveProperty('contextId');
  });

  it('joinFromInvitation sends the same body', async () => {
    const { calls, api } = fake();
    await api.joinFromInvitation('ns-acme', invitation);
    expect(Object.keys(calls[0].args[1] as object)).toEqual(['invitation']);
  });
});
