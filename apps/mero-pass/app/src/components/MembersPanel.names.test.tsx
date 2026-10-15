import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MeroPassClient } from '../generated/MeroPassClient';
import { ADMIN_CAPABILITIES } from '../lib/roles';
import type { VaultSession } from '../lib/vaultSession';

// ── People by name, not by account key ─────────────────────────────────────
//
// Nobody could set a name in Mero Pass, and the vault's People tab printed
// `aaaaaaaaaaaaaaaa…` for every person. The name lives on the namespace
// (member metadata, shared by every app on the team): the team's People tab
// can now set it, and every row that shows a person reads it.

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

const admin = {
  listGroupMembers: vi.fn(),
  getMemberCapabilities: vi
    .fn()
    .mockResolvedValue({ capabilities: ADMIN_CAPABILITIES }),
  getMemberMetadata: vi.fn().mockResolvedValue(null),
  setMemberMetadata: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@calimero-network/mero-react', () => ({
  useMero: () => ({ admin }),
}));

const { default: MembersPanel } = await import('./MembersPanel');
const { default: VaultPeople } = await import('./VaultPeople');

describe('member names', () => {
  it('names vault people and their devices from the team, not by account key', async () => {
    admin.listGroupMembers.mockResolvedValue({
      members: [{ identity: BOB, role: 'Member', name: 'Bob' }],
    });
    const client = {
      listMembers: vi
        .fn()
        .mockResolvedValue([{ account: BOB, role: 'editor', devices: 1 }]),
      listDevices: vi.fn().mockResolvedValue([
        {
          fingerprint: 'f'.repeat(64),
          public_key: '',
          label: 'Laptop',
          kind: 'browser',
          account: BOB,
          revoked: false,
        },
      ]),
    } as unknown as MeroPassClient;
    const session = {
      isAdmin: false,
      info: { my_account: ALICE, default_role: 'editor' },
    } as unknown as VaultSession;

    render(
      <VaultPeople
        client={client}
        session={session}
        team={{ namespaceId: 'ns-names', vaultId: 'v1' }}
        onChanged={() => {}}
      />,
    );

    const row = await screen.findByTestId('vault-member');
    await waitFor(() => expect(row).toHaveTextContent('Bob'));
    expect(row).not.toHaveTextContent(BOB.slice(0, 16));
    expect(screen.getByTestId('vault-device')).toHaveTextContent('Bob');
    expect(admin.listGroupMembers).toHaveBeenCalledWith('ns-names');
  });

  it('publishes "Your name" on the team and shows it on your row', async () => {
    admin.listGroupMembers.mockResolvedValue({
      members: [{ identity: ALICE, role: 'Admin' }],
    });
    render(
      <MembersPanel
        namespaceId="ns-panel"
        teamName="Acme"
        myAccountId={ALICE}
        myCapabilities={ADMIN_CAPABILITIES}
        onRolesChanged={() => {}}
      />,
    );
    await screen.findByTestId('member-row');

    fireEvent.change(screen.getByLabelText('Your name'), {
      target: { value: 'Alice' },
    });
    fireEvent.click(screen.getByTestId('my-name-save'));

    await waitFor(() =>
      expect(admin.setMemberMetadata).toHaveBeenCalledWith('ns-panel', ALICE, {
        name: 'Alice',
      }),
    );
    expect(await screen.findByTestId('member-row')).toHaveTextContent(
      'Alice (you)',
    );
  });
});
