import { describe, expect, it } from 'vitest';
import {
  contractErrorMessage,
  isMatchFinishedError,
  isShipsNotPlacedError,
  parseContractError,
} from './contractError';

/** Exactly what merod returned for a shot before both fleets were placed. */
const NODE1_BYTES =
  'the method call returned an error: [123, 34, 100, 97, 116, 97, 34, 58, 34, 98, 111, 116, 104, 32, 112, 108, 97, 121, 101, 114, 115, 32, 109, 117, 115, 116, 32, 112, 108, 97, 99, 101, 32, 115, 104, 105, 112, 115, 32, 102, 105, 114, 115, 116, 34, 44, 34, 107, 105, 110, 100, 34, 58, 34, 73, 110, 118, 97, 108, 105, 100, 34, 125]';

/** And what the other node returned for the same shot. */
const NODE2_BYTES =
  'the method call returned an error: [123, 34, 100, 97, 116, 97, 34, 58, 34, 110, 111, 116, 32, 97, 32, 112, 108, 97, 121, 101, 114, 34, 44, 34, 107, 105, 110, 100, 34, 58, 34, 70, 111, 114, 98, 105, 100, 100, 101, 110, 34, 125]';

describe('parseContractError', () => {
  it('decodes the byte array merod actually sends', () => {
    expect(parseContractError(new Error(NODE1_BYTES))).toEqual({
      data: 'both players must place ships first',
      kind: 'Invalid',
    });
  });

  it('decodes the other node’s refusal too', () => {
    expect(parseContractError(new Error(NODE2_BYTES))).toEqual({
      data: 'not a player',
      kind: 'Forbidden',
    });
  });

  it('reads a plain JSON body', () => {
    expect(parseContractError(new Error('{"data":"not your turn","kind":"Forbidden"}'))).toEqual({
      data: 'not your turn',
      kind: 'Forbidden',
    });
  });

  it('accepts a kind with no data — `{"kind":"Finished"}` carries none', () => {
    expect(parseContractError(new Error('{"kind":"Finished"}'))).toEqual({
      data: '',
      kind: 'Finished',
    });
  });

  it('returns null for a failure that is not a contract error', () => {
    expect(parseContractError(new Error('Network request failed'))).toBeNull();
    expect(parseContractError(undefined)).toBeNull();
    expect(parseContractError('')).toBeNull();
  });
});

describe('contractErrorMessage', () => {
  it('shows the contract’s own sentence', () => {
    expect(contractErrorMessage(new Error(NODE1_BYTES), 'Failed')).toBe(
      'both players must place ships first',
    );
  });

  it('names a finished match, which carries no data', () => {
    expect(contractErrorMessage(new Error('{"kind":"Finished"}'), 'Failed')).toBe(
      'This match is already finished',
    );
  });

  it('NEVER shows a raw byte array, even when it is not a contract body', () => {
    // The whole point: a wall of numbers is not a message.
    const msg = contractErrorMessage(new Error('boom [1, 2, 3, 4]'), 'Failed to fire shot');
    expect(msg).toBe('Failed to fire shot');
    expect(msg).not.toMatch(/\d+,\s*\d+/);
  });

  it('passes an ordinary error through unchanged', () => {
    expect(contractErrorMessage(new Error('Network request failed'), 'Failed')).toBe(
      'Network request failed',
    );
  });
});

describe('predicates', () => {
  it('spots the undeployed-fleet refusal', () => {
    expect(isShipsNotPlacedError(new Error(NODE1_BYTES))).toBe(true);
    expect(isShipsNotPlacedError(new Error(NODE2_BYTES))).toBe(false);
  });

  it('spots a finished match — the branch that used to be dead', () => {
    // `message.includes('Finished')` could never match the byte array, so the
    // match-over path never ran and the player got a raw error toast instead.
    expect(isMatchFinishedError(new Error('{"kind":"Finished"}'))).toBe(true);
    expect(isMatchFinishedError(new Error(NODE1_BYTES))).toBe(false);
  });
});
