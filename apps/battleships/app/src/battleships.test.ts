import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppError } from '@calimero-network/mero-js';
import { describe, expect, it, vi } from 'vitest';

import {
  CALLS,
  VIEWS,
  base64url,
  battleships,
  isMatchFinishedError,
  isShipsNotPlacedError,
  messageOf,
  toMatchRecord,
  toMatchSummary,
  toPlayerStats,
} from './battleships';
import { withRoutes } from '@calimero-apps/connect/testing';

/** The committed ABI of the contract (`mero-component build`; CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, '../../logic/res/abi.json'), 'utf8')) as {
  methods: Record<string, { kind: string; params: Array<[string, string]> }>;
  errors: Record<string, unknown>;
};

const byKind = (kind: string) =>
  Object.entries(abi.methods)
    .filter(([, m]) => m.kind === kind)
    .map(([name]) => name)
    .sort();

const STATE = {
  standing: 'playing',
  committed: [],
  pending_shot: null,
  ended_by: null,
  loser: null,
  revealed: [],
  audit_failed: [],
  winner: null,
};

describe('the client covers the contract', () => {
  it('calls exactly the contract\'s calls, and views exactly its views', () => {
    expect([...CALLS].sort()).toEqual(byKind('call'));
    expect([...VIEWS].sort()).toEqual(byKind('view'));
    expect(byKind('init')).toEqual(['init']);
  });

  it('sends each method the parameter names the ABI declares', async () => {
    const sent = new Map<string, string[]>();
    const record = (_app: string, method: string, args: unknown = {}) => {
      sent.set(method, Object.keys(args as object).sort());
      const result =
        method === 'getMatches' || method === 'getHistory' || method === 'getPlayers'
          ? []
          : method === 'getMatchState'
            ? STATE
            : method === 'getShots' || method === 'getIncomingShots'
              ? { size: 10, shots: [] }
              : null;
      return Promise.resolve({ index: 1, result, events: [] });
    };
    const b = battleships(withRoutes({ call: vi.fn(record), view: vi.fn(record) }), 'app-1');
    const match_id = 'm';
    await Promise.all([
      b.registerPlayer(),
      b.getPlayers(),
      b.createMatch({ player2: 'bob' }),
      b.getMatches(),
      b.getPlayerStats({ player: 'bob' }),
      b.getHistory(),
      b.commitBoard({ match_id, commitment: 'ab' }),
      b.proposeShot({ match_id, x: 1, y: 2 }),
      b.acknowledgeShot({ match_id, shot_id: 0, hit: true }),
      b.revealBoard({ match_id, board_bytes: new Uint8Array([1]), salt: new Uint8Array(16) }),
      b.getShots({ match_id }),
      b.getIncomingShots({ match_id }),
      b.getMatchState({ match_id }),
      b.getActiveMatchId(),
      b.getCurrentTurn({ match_id }),
      b.getWinner({ match_id }),
      b.getCurrentUser(),
    ]);
    for (const [name, method] of Object.entries(abi.methods)) {
      if (method.kind === 'init') continue;
      expect(sent.get(name), name).toEqual(method.params.map(([p]) => p).sort());
    }
  });

  it('has words for every refusal the contract can answer', () => {
    for (const code of Object.keys(abi.errors)) {
      const e = new AppError('refused', { code, fields: {} });
      expect(messageOf(e), code).not.toBe(code);
      expect(messageOf(e), code).not.toBe('refused');
    }
  });
});

describe('battleships', () => {
  it('sends the reveal\'s bytes as base64url, and tracks the newest index', async () => {
    const call = vi.fn().mockResolvedValue({ index: 7, result: null, events: [] });
    const after = vi.fn();
    const b = battleships(withRoutes({ call, view: vi.fn() }), 'app-1', after);
    await b.revealBoard({
      match_id: 'm1',
      board_bytes: new Uint8Array([100, 0, 0, 0, 1, 0]),
      salt: new Uint8Array(16).fill(0xa5),
    });
    expect(call).toHaveBeenCalledWith('app-1', 'revealBoard', {
      matchId: 'm1',
      boardBytes: 'ZAAAAAEA',
      salt: 'paWlpaWlpaWlpaWlpaWlpQ',
    });
    expect(b.index()).toBe(7);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('runs `after` when a request fails too, and words the refusal', async () => {
    const after = vi.fn();
    const refusal = new AppError('refused', { code: 'Forbidden', fields: { message: 'not your turn' } });
    const b = battleships(withRoutes({ call: vi.fn().mockRejectedValue(refusal), view: vi.fn() }), 'a', after);
    await expect(b.proposeShot({ match_id: 'm', x: 0, y: 0 })).rejects.toBe(refusal);
    expect(after).toHaveBeenCalledTimes(1);
    expect(messageOf(refusal)).toBe('Not your turn');
    expect(messageOf(new Error('boom'))).toBe('boom');
  });

  it('recognises the refusals the match screen handles', () => {
    expect(isMatchFinishedError(new AppError('x', { code: 'Finished', fields: {} }))).toBe(true);
    expect(
      isShipsNotPlacedError(
        new AppError('x', { code: 'Invalid', fields: { message: 'both players must place ships first' } }),
      ),
    ).toBe(true);
    expect(isShipsNotPlacedError(new Error('both players must place ships first'))).toBe(false);
  });
});

describe('the adapter back to the screens\' shapes', () => {
  it('turns u64 decimal strings into numbers', () => {
    expect(
      toMatchSummary({
        match_id: 'm',
        player1: 'a',
        player2: 'b',
        player2_account: 'b',
        status: 'Active',
        winner: null,
        created_ms: '1700000000000',
      }).created_ms,
    ).toBe(1_700_000_000_000);
    expect(toMatchRecord({ match_id: 'm', winner: 'a', loser: 'b', finished_ms: '5' }).finished_ms).toBe(5);
    expect(toPlayerStats({ wins: '2', losses: '1', games_played: '3' })).toEqual({
      wins: 2,
      losses: 1,
      games_played: 3,
    });
  });

  it('encodes base64url without padding', () => {
    expect(base64url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(base64url(new Uint8Array([]))).toBe('');
  });
});
