import { describe, expect, it } from 'vitest';
import { parseContractError } from '../contractError';
import { contractErrorFixture } from './contractErrorFixture';

describe('parseContractError', () => {
  it('reads the kind and detail core carries for a refused call', () => {
    expect(parseContractError(contractErrorFixture('NotFound', 'doc-1'))).toEqual({
      kind: 'NotFound',
      data: 'doc-1',
    });
  });

  it('reads the bytes core sent for a real get_folder refusal', () => {
    const err = Object.assign(new Error('FunctionCallError'), {
      type: 'FunctionCallError',
      data:
        'the method call returned an error: [123, 34, 100, 97, 116, 97, 34, 58, 34, 103, 104, 111, 115, 116, 34, 44, 34, 107, 105, 110, 100, 34, 58, 34, 78, 111, 116, 70, 111, 117, 110, 100, 34, 125]',
    });
    expect(parseContractError(err)).toEqual({ kind: 'NotFound', data: 'ghost' });
  });

  it('keeps multi-byte detail intact', () => {
    expect(parseContractError(contractErrorFixture('Invalid', 'café'))?.data).toBe('café');
  });

  it.each([
    ['a plain error', new Error('boom')],
    ['a string', 'not found'],
    ['null', null],
    ['prose that says not found', Object.assign(new Error('FunctionCallError'), { data: 'not found: doc-1' })],
    ['a byte list that is not JSON', Object.assign(new Error('x'), { data: 'the method call returned an error: [65, 66]' })],
    ['a kind the contract does not define', contractErrorFixture('Teapot', 'x')],
    ['a body with no detail', Object.assign(new Error('x'), { data: `the method call returned an error: [${Array.from(new TextEncoder().encode('{"kind":"NotFound"}')).join(', ')}]` })],
  ])('is null for %s', (_name, err) => {
    expect(parseContractError(err)).toBeNull();
  });
});
