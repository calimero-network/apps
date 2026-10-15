import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ADMIN_CAPABILITIES } from '../lib/roles';

// ── The TEE node is not a person ────────────────────────────────────────────
//
// A TEE fleet node is admitted to the team as a `ReadOnlyTee` / `RelayTee`
// member row. It used to be listed here as a nameless "Member" with Promote and
// Remove buttons. It is infrastructure: the panel leaves it out of the people
// and says "TEE enabled" instead. Drives the real `listTeamMembers` against a
// fake admin, so the split is the one the data layer makes.

const admin = {
  listGroupMembers: vi.fn(),
  getMemberCapabilities: vi.fn(),
};
vi.mock('@calimero-network/mero-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMero: () => ({ admin }),
}));

const { default: MembersPanel } = await import('./MembersPanel');

const ALICE = { identity: 'a'.repeat(64), role: 'Admin', name: 'Alice' };

function renderPanel() {
  return render(
    <MembersPanel
      namespaceId="ns-1"
      teamName="Acme"
      myAccountId={ALICE.identity}
      myCapabilities={ADMIN_CAPABILITIES}
      onRolesChanged={() => {}}
    />,
  );
}

beforeEach(() => {
  admin.listGroupMembers.mockReset();
  admin.getMemberCapabilities
    .mockReset()
    .mockResolvedValue({ capabilities: ADMIN_CAPABILITIES });
});

describe('MembersPanel TEE indicator', () => {
  it('lists people only and shows "TEE enabled" when a TEE node is admitted', async () => {
    admin.listGroupMembers.mockResolvedValue({
      members: [ALICE, { identity: 'c'.repeat(64), role: 'RelayTee' }],
    });
    renderPanel();

    const indicator = await screen.findByTestId('tee-indicator');
    expect(indicator).toHaveTextContent('TEE enabled');
    expect(indicator).toHaveTextContent('Relay');
    expect(indicator).toHaveAttribute(
      'title',
      expect.stringMatching(/hardware-attested node keeps this workspace/i),
    );
    expect(screen.getAllByTestId('member-row')).toHaveLength(1);
    expect(screen.getByTestId('member-list')).toHaveTextContent('Alice');
  });

  it('says Replica when every TEE node is read-only', async () => {
    admin.listGroupMembers.mockResolvedValue({
      members: [ALICE, { identity: 'd'.repeat(64), role: 'ReadOnlyTee' }],
    });
    renderPanel();

    expect(await screen.findByTestId('tee-indicator')).toHaveTextContent(
      'Replica',
    );
  });

  it('shows no indicator when the team has no TEE node', async () => {
    admin.listGroupMembers.mockResolvedValue({ members: [ALICE] });
    renderPanel();

    expect(await screen.findAllByTestId('member-row')).toHaveLength(1);
    expect(screen.queryByTestId('tee-indicator')).not.toBeInTheDocument();
  });
});
