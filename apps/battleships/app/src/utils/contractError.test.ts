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

// ── The shapes this actually arrives in ──────────────────────────────────────

/** The full JSON-RPC envelope, exactly as merod returns it. */
const ENVELOPE = {
  jsonrpc: '2.0',
  id: 1,
  error: { type: 'FunctionCallError', data: NODE1_BYTES },
};

describe('structural parsing', () => {
  it('takes the whole JSON-RPC envelope as an OBJECT', () => {
    // A caller holding the parsed response should not have to stringify it.
    expect(parseContractError(ENVELOPE)).toEqual({
      data: 'both players must place ships first',
      kind: 'Invalid',
    });
  });

  it('takes the envelope as a JSON STRING too', () => {
    expect(parseContractError(JSON.stringify(ENVELOPE))).toEqual({
      data: 'both players must place ships first',
      kind: 'Invalid',
    });
  });

  it('takes a raw byte ARRAY, not just a stringified one', () => {
    const bytes = Array.from(
      new TextEncoder().encode('{"data":"not your turn","kind":"Forbidden"}'),
    );
    expect(parseContractError(bytes)).toEqual({ data: 'not your turn', kind: 'Forbidden' });
  });

  it('unwraps an axios-shaped error', () => {
    expect(parseContractError({ response: { data: ENVELOPE } })).toEqual({
      data: 'both players must place ships first',
      kind: 'Invalid',
    });
  });

  it('picks the CONTRACT array, not the first bracketed run in the message', () => {
    // The old regex took whichever `[...]` came first. Here that is a board
    // coordinate, and "decoding" it would have produced mojibake presented as
    // if the contract had said it.
    const msg = `shot at [3, 4] rejected: ${NODE1_BYTES}`;
    expect(parseContractError(new Error(msg))).toEqual({
      data: 'both players must place ships first',
      kind: 'Invalid',
    });
  });

  it('does not mistake a non-text number list for a payload', () => {
    // Valid bytes, but not valid UTF-8 — must fail rather than half-decode.
    expect(parseContractError(new Error('sizes [200, 201, 202, 203]'))).toBeNull();
    // And a version triple is not a payload either.
    expect(parseContractError(new Error('version [1, 4, 1]'))).toBeNull();
  });

  it('rejects a bracketed run that is not bytes at all', () => {
    expect(parseContractError(new Error('coords [3.5, 4.5]'))).toBeNull();
    expect(parseContractError(new Error('range [-1, 300]'))).toBeNull();
  });

  it('survives two objects in one message rather than spanning both', () => {
    // `indexOf('{')` + `lastIndexOf('}')` used to slice across the pair and
    // fail to parse; balanced scanning reads them as two runs.
    const msg = '{"note":"first"} then {"data":"not a player","kind":"Forbidden"}';
    expect(parseContractError(new Error(msg))).toEqual({
      data: 'not a player',
      kind: 'Forbidden',
    });
  });

  it('terminates on a self-referencing object', () => {
    const loop: Record<string, unknown> = {};
    loop.cause = loop;
    expect(parseContractError(loop)).toBeNull();
  });
});
