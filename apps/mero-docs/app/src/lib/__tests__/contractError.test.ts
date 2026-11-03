import { describe, expect, it } from 'vitest';
import { parseContractError } from '../contractError';
import { contractErrorFixture, nodeError } from './contractErrorFixture';

describe('parseContractError', () => {
  it('reads the code and message of the contract refusal', () => {
    expect(parseContractError(contractErrorFixture('NotFound', 'doc-1'))).toEqual({
      kind: 'NotFound',
      data: 'doc-1',
    });
  });

  it('keeps multi-byte detail intact', () => {
    expect(parseContractError(contractErrorFixture('Invalid', 'café'))?.data).toBe('café');
  });

  it.each([
    ['a plain error', new Error('boom')],
    ['a string', 'not found'],
    ['null', null],
    ['a node refusal', nodeError(404)],
    ['a code the contract does not define', contractErrorFixture('Teapot', 'x')],
  ])('is null for %s', (_name, err) => {
    expect(parseContractError(err)).toBeNull();
  });
});
