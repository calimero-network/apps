import { beforeAll, describe, expect, it } from 'vitest';
import { MeroJs } from '@calimero-network/mero-js';
import {
  createTeam,
  createVault,
  mintTeamInvite,
  acceptInvite,
  enterVaultContext,
} from '../../src/lib/vaults';
import { decodeInvite } from '../../src/lib/inviteCodec';

// ── The reported 403 ───────────────────────────────────────────────────────
//
//     The vault did not admit you after 20s (HTTP 403 Forbidden: identity not
//     eligible for inheritance-based join). Could not read the vault's
//     visibility.
//
// ⚠️ IT WAS NOT A TIMEOUT, though it read as one. `createVault` created the
// subgroup with no `visibility`, which is born RESTRICTED, then opened it with
// a second governance write. A member who joined the team AFTER the vault
// existed never received that second write. Polled from their node, every
// three seconds:
//
//     nsMembers=2  myMask=4  subgroups=1  vis=500  join=403
//
// for sixty seconds, through explicit `syncGroup` on both the namespace and
// the subgroup. It had the namespace in full and the subgroup's id, and the
// vault was restricted from where it stood — permanently. The refusal was
// correct.
//
// Born open, the visibility is part of the record that creates the subgroup:
//
//     nsMembers=2  myMask=4  subgroups=1  vis=open  join=OK    (t=0s)

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
    (a) => a.package === 'com.calimero.mero-pass',
  )!.id;
  acct1 = (await n1.admin.getNodeIdentity()).accountId;
}, 300_000);

describe('a member entering a vault that predates their membership', () => {
  it('is admitted, with no settle time, three times running', async () => {
    const took: number[] = [];
    for (let i = 1; i <= 3; i += 1) {
      const { namespaceId } = await createTeam(n1.admin, {
        applicationId,
        name: `open-at-birth-${i}`,
        accountId: acct1,
      });
      // The order that used to fail: the vault exists BEFORE the invite.
      const vault = await createVault(n1.admin, {
        applicationId,
        namespaceId,
        name: 'V',
      });
      const code = await mintTeamInvite(n1.admin, {
        namespaceId,
        teamName: `open-at-birth-${i}`,
      });
      await acceptInvite(n2.admin, decodeInvite(code)!);

      // No sleep at all — the point is that nothing needs to settle.
      const t0 = Date.now();
      const identity = await enterVaultContext(n2.admin, {
        vaultId: vault.vaultId,
        contextId: vault.contextId,
        namespaceId,
      });
      took.push(Date.now() - t0);
      expect(identity).toMatch(/^[0-9a-f]{64}$/);

      // And the joiner can READ the visibility, which was a 500 before.
      const info = await n2.admin.getGroupInfo(vault.vaultId);
      expect(info.subgroupVisibility).toBe('open');
    }
    console.log('  admitted after (ms):', took.join(', '));
  }, 300_000);
});
