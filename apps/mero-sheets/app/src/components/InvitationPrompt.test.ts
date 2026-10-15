// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── A join of the workspace the page already shows ──────────────────────────
//
// The dialog stays on "Syncing…" until the joined namespace's just-joined flag
// is cleared, which the page does once that workspace's spreadsheets are read.
// When the page already shows the workspace (the inviter made a new spreadsheet
// in one this node joined before), it settles the moment it hears of the join.
// The prompt reported the join from inside `redeem`, before the redemption
// marked the namespace: the page settled and cleared, the mark landed after,
// nothing cleared it again, and the dialog sat on "Syncing…" (Browser E2E).

const mero = { admin: {} };
vi.mock('@calimero-network/mero-react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@calimero-network/mero-react')>()),
  useMero: () => ({ mero }),
}));

const acceptInvite = vi.fn();
vi.mock('../lib/workspaces', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/workspaces')>()),
  acceptInvite: (...args: unknown[]) => acceptInvite(...args),
}));

const {
  clearNamespaceJustJoined,
  isNamespaceJustJoined,
  markNamespaceJustJoined,
  resetInvitationCaptureForTests,
} = await import('@calimero-network/mero-react');
const { encodeInvite } = await import('../lib/inviteCodec');
const { default: InvitationPrompt } = await import('./InvitationPrompt');

const NS = '010203';
const CODE = encodeInvite({
  invitation: {
    invitation: { group_id: [1, 2, 3], invited_role: 0 },
    inviter_signature: 'ff'.repeat(64),
  },
  groupAlias: 'Acme',
  contextId: 'ctx-2',
} as never);

beforeEach(() => {
  resetInvitationCaptureForTests();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, '', `/?invitation=${CODE}`);
  acceptInvite.mockReset();
  acceptInvite.mockResolvedValue({ namespaceId: NS, contextId: 'ctx-2' });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('InvitationPrompt', () => {
  it('reports the join after the namespace is marked, so a page that settles at once clears it', async () => {
    const seen: { flagged: boolean; landed: unknown }[] = [];
    // The page already showing this workspace: it marks the join (as
    // `landJoined` does) and, its spreadsheets being on hand, settles at once.
    const onJoined = (landed: { namespaceId: string | null; contextId: string | null }) => {
      seen.push({ flagged: isNamespaceJustJoined(NS), landed });
      markNamespaceJustJoined(landed.namespaceId);
      clearNamespaceJustJoined(landed.namespaceId!);
    };
    render(createElement(InvitationPrompt, { onJoined, enabled: true }));
    fireEvent.click(await screen.findByTestId('invite-accept'));

    await waitFor(() => expect(seen).toHaveLength(1));
    // The redemption had already marked it when the page heard of the join.
    expect(seen[0]).toEqual({ flagged: true, landed: { namespaceId: NS, contextId: 'ctx-2' } });
    await act(async () => {});
    expect(isNamespaceJustJoined(NS)).toBe(false);
    await waitFor(() =>
      expect(screen.queryByTestId('invite-prompt')?.getAttribute('data-stage')).not.toBe(
        'syncing',
      ),
    );
  });
});
