// The lobby listed players, winners and history only as key fragments
// (`SSSSSSSSSS…SSSSSS`, `Winner: OOOOOOOO...`), with no way to set a name.

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import LobbyView from './LobbyView';
import { playerName } from '../utils/playerName';

const self = 'a'.repeat(64);
const opponent = 'b'.repeat(64);
const stranger = 'c'.repeat(64);
const selfKey = 'S'.repeat(44);
const opponentKey = 'O'.repeat(44);
const strangerKey = 'X'.repeat(44);
const names: Record<string, string> = { [self]: 'Sandi', [opponent]: 'Ana' };
const nameOf = (account: string) => names[account];

const renderLobby = (extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(
    createElement(LobbyView, {
      lobbyAlias: 'Harbour',
      isAdmin: true,
      members: [
        { identity: self, role: 'Admin' },
        { identity: opponent, role: 'Member' },
      ],
      membersLoading: false,
      playerKeys: [selfKey, opponentKey],
      playerByAccount: { [opponent]: opponentKey },
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
      matches: [{ match_id: 'm1', status: 'Finished', winner: opponentKey, context_id: null }],
      onOpenGame: vi.fn(),
      playerStats: null,
      history: [],
      currentUser: selfKey,
      nameOf,
      onSaveName: vi.fn(),
      ...extra,
    } as unknown as Parameters<typeof LobbyView>[0]),
  );

describe('LobbyView – namespace names', () => {
  it('lists members by the name they set for the namespace', () => {
    const html = renderLobby();
    expect(html).toContain('Sandi');
    expect(html).toContain('Ana');
    expect(html).not.toContain(`${opponentKey.slice(0, 10)}…`);
    // Challenge still works off the key.
    expect(html).toContain('data-testid="challenge-player"');
  });

  it('names the winner of a match', () => {
    expect(renderLobby()).toContain('Winner: Ana');
  });

  it('offers a field to set your own name, prefilled from the namespace', () => {
    const html = renderLobby();
    expect(html).toContain('id="lobby-your-name"');
    expect(html).toContain('value="Sandi"');
    expect(renderLobby({ onSaveName: undefined })).not.toContain('id="lobby-your-name"');
  });
});

describe('playerName', () => {
  const sources = {
    playerByAccount: { [opponent]: opponentKey },
    selfIdentity: self,
    executorPublicKey: selfKey,
    nameOf,
  };

  it('resolves a player key through the lobby map to the account name', () => {
    expect(playerName(opponentKey, sources)).toBe('Ana');
    expect(playerName(selfKey, sources)).toBe('Sandi');
  });

  it('falls back to a short key for an unnamed player', () => {
    expect(playerName(strangerKey, { ...sources, playerByAccount: { [stranger]: strangerKey } })).toBe('XXXXXXXX…XXXX');
    expect(playerName(strangerKey, { ...sources, nameOf: undefined })).toBe('XXXXXXXX…XXXX');
  });
});
