import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppError } from '@calimero-network/mero-js';
import { describe, expect, it, vi } from 'vitest';

import {
  base64url,
  isMatchFinishedError,
  isShipsNotPlacedError,
  lobby,
  messageOf,
  toMatchRecord,
  toMatchSummary,
  toPlayerStats,
} from './battleships';
import { withRoutes } from '@calimero-apps/connect/testing';

/** The committed ABI of the contract (`scripts/component-build.sh` (meroctl app build); CI asserts it is current). */
const abi = JSON.parse(readFileSync(resolve(__dirname, '../../logic/res/abi.json'), 'utf8')) as {
  errors: Record<string, unknown>;
};

describe('the contract\'s refusals', () => {
  it('has words for every refusal the contract can answer', () => {
    for (const code of Object.keys(abi.errors)) {
      const e = new AppError('refused', { code, fields: {} });
      expect(messageOf(e), code).not.toBe(code);
      expect(messageOf(e), code).not.toBe('refused');
    }
  });
});

describe('lobby', () => {
  it('sends the reveal\'s bytes as base64url, and tracks the newest index', async () => {
    const call = vi.fn().mockResolvedValue({ index: 7, result: null, events: [] });
    const after = vi.fn();
    const b = lobby(withRoutes({ call, view: vi.fn() }), 'app-1', after);
    expect(b.index()).toBe(0);
    await b.contract.revealBoard({
      matchId: 'm1',
      boardBytes: base64url(new Uint8Array([100, 0, 0, 0, 1, 0])),
      salt: base64url(new Uint8Array(16).fill(0xa5)),
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
    const b = lobby(withRoutes({ call: vi.fn().mockRejectedValue(refusal), view: vi.fn() }), 'a', after);
    await expect(b.contract.proposeShot({ matchId: 'm', x: 0, y: 0 })).rejects.toBe(refusal);
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
