import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import LobbyView from '../components/LobbyView';
import { splitTeeMembers } from './useBattleshipsLobby';

describe('useBattleshipsLobby', () => {
  it('exports the hook', async () => {
    const mod = await import('./useBattleshipsLobby');
    expect(typeof mod.useBattleshipsLobby).toBe('function');
  });
});

describe('TEE nodes in the lobby', () => {
  const self = 'a'.repeat(64);
  const opponent = 'b'.repeat(64);
  const selfKey = 'S'.repeat(44);
  const opponentKey = 'O'.repeat(44);
  // A TEE fleet node is admitted to the namespace as a member row, so core's
  // `listGroupMembers` returns it next to the two players.
  const raw = [
    { identity: self, role: 'Admin' },
    { identity: opponent, role: 'Member' },
    { identity: 'c'.repeat(64), role: 'ReadOnlyTee' },
  ];

  const renderLobby = (
    members: { identity: string; role: string }[],
    teeMembers: { identity: string; role: string }[] = [],
  ) =>
    renderToStaticMarkup(
      createElement(LobbyView, {
        lobbyAlias: 'Harbour',
        isAdmin: true,
        members,
        teeMembers,
        membersLoading: false,
        // No `register_player` map: the two-player fallback has to resolve
        // the opponent's key.
        playerKeys: [selfKey, opponentKey],
        playerByAccount: {},
        onChallengePlayer: vi.fn(),
        selfIdentity: self,
        executorPublicKey: selfKey,
        inviteLoading: false,
        invitationJson: null,
        onCreateInvitation: vi.fn(),
        onDismissInvitation: vi.fn(),
        player2: '',
        creatingMatch: false,
        onPlayer2Change: vi.fn(),
        onCreateMatch: vi.fn(),
        matches: [],
        onOpenGame: vi.fn(),
        playerStats: null,
        history: [],
        currentUser: null,
      }),
    );

  it('keeps TEE nodes out of `members` and reports them as `teeMembers`', () => {
    const { members, teeMembers } = splitTeeMembers([
      ...raw,
      { identity: 'd'.repeat(64), role: 'RelayTee' },
    ]);

    expect(members.map((m) => m.identity)).toEqual([self, opponent]);
    expect(teeMembers.map((m) => m.role)).toEqual(['ReadOnlyTee', 'RelayTee']);
  });

  // The TEE row made the fallback see two "other" members, so the opponent's
  // key went unresolved: their row read "hasn't opened the lobby yet" and
  // the Challenge button disappeared.
  it('still offers Challenge for the opponent when a TEE node is in the group', () => {
    const { members, teeMembers } = splitTeeMembers(raw);
    const html = renderLobby(members, teeMembers);

    expect(html).toContain('data-testid="challenge-player"');
    expect(html).toContain('2 members online');
    expect(html).not.toContain('ReadOnlyTee');
  });

  it('shows the TEE indicator only when a TEE node is admitted', () => {
    const { members, teeMembers } = splitTeeMembers(raw);

    expect(renderLobby(members, teeMembers)).toContain('TEE enabled');
    expect(renderLobby(members, [])).not.toContain('TEE enabled');
  });

  it('names Relay mode when any TEE node is a relay', () => {
    const { members, teeMembers } = splitTeeMembers([
      ...raw,
      { identity: 'd'.repeat(64), role: 'RelayTee' },
    ]);

    expect(renderLobby(members, teeMembers)).toContain('Relay');
    expect(renderLobby(members, splitTeeMembers(raw).teeMembers)).toContain('Replica');
  });
});
