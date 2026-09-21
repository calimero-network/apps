import { beforeAll, describe, expect, it } from 'vitest';
import { MeroJs } from '@calimero-network/mero-js';

import { createWorkspace, createAgreement } from '../../src/lib/agreements';
import { encodeInvite } from '../../src/lib/inviteCodec';
import { nodeApi, setMeroInstance } from '../../src/lib/node';
import { meroApp } from '../../src/lib/meroApp';
import { redeemInvitation } from '../../src/api/invitationJoin';

// ── Redeeming an invitation, across two real nodes ─────────────────────────
//
// Reported twice; they were one bug wearing two faces:
//
//     {"error":"Invalid context id format: expected 64 hex characters"}
//     No node connection yet, so this invitation cannot be redeemed.
//
// `meroApp.joinContext` handed the invitation PAYLOAD to
// `admin.joinContext(contextId)`, which wants a 64-hex context id — hence the
// first. `ContextApiDataSource` swallowed that and replaced it with the
// second, which was untrue and sent people to look at their node.
//
// This drives `redeemInvitation`, the function the app actually calls, so the
// whole chain is under test: decode, join the NAMESPACE, find the agreement,
// enter its subgroup.

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  },
});

let n1: MeroJs,
  n2: MeroJs,
  applicationId = '',
  acct1 = '';
const connect = async (url: string) => {
  const m = new MeroJs({ baseUrl: url });
  await m.authenticate({ username: 'admin', password: 'calimero1234' });
  return m;
};

beforeAll(async () => {
  n1 = await connect('http://127.0.0.1:2428');
  n2 = await connect('http://127.0.0.1:2429');
  applicationId = (await n1.admin.listApplications()).apps.find(
    (a) => a.package === 'com.calimero.mero-sign',
  )!.id;
  acct1 = (await n1.admin.getNodeIdentity()).accountId;
}, 300_000);

describe('redeemInvitation', () => {
  it('joins the workspace and lands in its agreement', async () => {
    setMeroInstance(n1);
    const { namespaceId } = await createWorkspace(n1.admin, {
      applicationId,
      name: 'Join live',
      accountId: acct1,
    });
    const agreement = await createAgreement(n1.admin, {
      applicationId,
      namespaceId,
      name: 'NDA',
    });

    const minted = await nodeApi(n1).contextInviteByOpenInvitation(namespaceId);
    expect(minted.error ?? null).toBeNull();
    const code = encodeInvite({
      invitation: minted.data as never,
      contextId: agreement.contextId,
      contextName: 'NDA',
      workspaceName: 'Join live',
    });

    // Now as the JOINER.
    setMeroInstance(n2);
    const result = await redeemInvitation(code, meroApp(n2, null));

    expect(result.namespaceId).toBe(namespaceId);
    // The workspace holds one agreement, so it resolves to that one.
    expect(result.contextId).toBe(agreement.contextId);
    expect(result.memberPublicKey).toMatch(/^[0-9a-f]{64}$/);

    // And node2 really is a member of both.
    const nsMembers = await n2.admin.listGroupMembers(namespaceId);
    expect((nsMembers.members ?? []).length).toBe(2);
    const owned = await n2.admin.getContextIdentitiesOwned(agreement.contextId);
    expect(owned.identities.length).toBeGreaterThan(0);
  }, 300_000);
});
