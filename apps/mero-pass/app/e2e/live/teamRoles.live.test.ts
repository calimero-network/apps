import { beforeAll, describe, expect, it } from 'vitest';
import { MeroJs } from '@calimero-network/mero-js';
import {
  createTeam,
  mintTeamInvite,
  acceptInvite,
  myCapabilities,
  repairCreatorAdmin,
} from '../../src/lib/vaults';
import { decodeInvite } from '../../src/lib/inviteCodec';

// ── Role vs mask, against two REAL nodes ───────────────────────────────────
//
// ⚠️ WHY THIS CANNOT BE A UNIT TEST. Core has TWO permission systems and this
// app touches both: `setMemberCapabilities` writes a capability MASK, while
// `require_namespace_admin` — the gate on every namespace mutation — checks
// the member's ROLE row (`MembershipRepository::is_admin`). A mock cannot
// disagree with itself the way the node does, so only a node can show that an
// account holding role `Member` is refused however the mask is set.
//
// What this pins is the reported bug: `repairCreatorAdmin` ran on every
// team-page load for every member, and for an invited member — whose mask is
// Member by design and will never rise — the write is refused
//
//     HTTP 403  identity AccountId([...]) is not an admin of group
//               ContextGroupId([...])
//
// forever, on every load, swallowed. The UI said nothing; the network tab
// said the app was broken.
//
// Setup: two local nodes with mero-pass installed. See
// `~/.calimero/dev-nodes.sh`, then `pnpm test:live`.

let n1: MeroJs,
  n2: MeroJs,
  applicationId = '',
  acct1 = '',
  acct2 = '';
const connect = async (url: string) => {
  const m = new MeroJs({ baseUrl: url });
  await m.authenticate({ username: 'admin', password: 'calimero1234' });
  return m;
};
beforeAll(async () => {
  n1 = await connect('http://127.0.0.1:2428');
  n2 = await connect('http://127.0.0.1:2429');
  applicationId = (await n1.admin.listApplications()).apps.find(
    (a) => a.package === 'com.calimero.mero-pass',
  )!.id;
  acct1 = (await n1.admin.getNodeIdentity()).accountId;
  acct2 = (await n2.admin.getNodeIdentity()).accountId;
}, 180_000);

describe('repairCreatorAdmin provokes no 403 for a Member', () => {
  it('a Member load fires no admin write at all', async () => {
    const { namespaceId } = await createTeam(n1.admin, {
      applicationId,
      name: 'No-403 probe',
      accountId: acct1,
    });
    const code = await mintTeamInvite(n1.admin, {
      namespaceId,
      teamName: 'No-403 probe',
    });
    await acceptInvite(n2.admin, decodeInvite(code)!);
    await new Promise((r) => setTimeout(r, 6000));

    // Count the writes the node actually receives.
    let writes = 0;
    const real = n2.admin.setMemberCapabilities.bind(n2.admin);
    n2.admin.setMemberCapabilities = (async (...a: Parameters<typeof real>) => {
      writes += 1;
      return real(...a);
    }) as typeof real;

    const mask = await myCapabilities(n2.admin, namespaceId, acct2);
    const out = await repairCreatorAdmin(n2.admin, namespaceId, acct2, mask);
    console.log(
      'member mask =',
      mask,
      ' repair returned =',
      out,
      ' admin writes attempted =',
      writes,
    );
    expect(writes).toBe(0);
    expect(out).toBeNull();
  }, 240_000);

  it('still repairs a real Admin whose mask fell behind', async () => {
    const { namespaceId } = await createTeam(n1.admin, {
      applicationId,
      name: 'Legacy team',
      accountId: acct1,
    });
    // Simulate the legacy state: Admin by role, Member mask.
    await n1.admin.setMemberCapabilities(namespaceId, acct1, {
      capabilities: 4,
    });
    const before = await myCapabilities(n1.admin, namespaceId, acct1);
    const after = await repairCreatorAdmin(
      n1.admin,
      namespaceId,
      acct1,
      before,
    );
    console.log('legacy creator: before =', before, ' after =', after);
    expect(before).toBe(4);
    expect(after).not.toBeNull();
  }, 240_000);
});
