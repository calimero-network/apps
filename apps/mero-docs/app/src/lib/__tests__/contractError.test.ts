import { describe, expect, it } from 'vitest';
import { parseContractError } from '../contractError';
import { CONTRACT_ERROR_SHAPES, contractErrorFixture } from './contractErrorFixture';

describe('parseContractError', () => {
  it.each(CONTRACT_ERROR_SHAPES)('reads the kind and detail core carries for a refused call, rendered as %s', (shape) => {
    expect(parseContractError(contractErrorFixture('NotFound', 'doc-1', shape))).toEqual({
      kind: 'NotFound',
      data: 'doc-1',
    });
  });

  it('reads the same refusal whether core rendered it as text or as bytes', () => {
    expect(parseContractError(contractErrorFixture('Forbidden', 'not yours', 'text'))).toEqual(
      parseContractError(contractErrorFixture('Forbidden', 'not yours', 'bytes')),
    );
  });

  it('reads the bytes an older node sent for a real get_folder refusal', () => {
    const err = Object.assign(new Error('FunctionCallError'), {
      type: 'FunctionCallError',
      data:
        'the method call returned an error: [123, 34, 100, 97, 116, 97, 34, 58, 34, 103, 104, 111, 115, 116, 34, 44, 34, 107, 105, 110, 100, 34, 58, 34, 78, 111, 116, 70, 111, 117, 110, 100, 34, 125]',
    });
    expect(parseContractError(err)).toEqual({ kind: 'NotFound', data: 'ghost' });
  });

  it('reads the text rc.81 sends for the same refusal', () => {
    const err = Object.assign(new Error('FunctionCallError'), {
      type: 'FunctionCallError',
      data: 'the method call returned an error: {"data":"ghost","kind":"NotFound"}',
    });
    expect(parseContractError(err)).toEqual({ kind: 'NotFound', data: 'ghost' });
  });

  it.each(CONTRACT_ERROR_SHAPES)('keeps multi-byte detail intact as %s', (shape) => {
    expect(parseContractError(contractErrorFixture('Invalid', 'café', shape))?.data).toBe('café');
  });

  it.each([
    ['a plain error', new Error('boom')],
    ['a string', 'not found'],
    ['null', null],
    ['prose that says not found', Object.assign(new Error('FunctionCallError'), { data: 'not found: doc-1' })],
    ['prose behind the prefix', Object.assign(new Error('x'), { data: 'the method call returned an error: not found' })],
    ['a byte list that is not JSON', Object.assign(new Error('x'), { data: 'the method call returned an error: [65, 66]' })],
    ['a kind the contract does not define, as text', contractErrorFixture('Teapot', 'x', 'text')],
    ['a kind the contract does not define, as bytes', contractErrorFixture('Teapot', 'x', 'bytes')],
    ['a body with no detail, as text', Object.assign(new Error('x'), { data: 'the method call returned an error: {"kind":"NotFound"}' })],
    ['a body with no detail, as bytes', Object.assign(new Error('x'), { data: `the method call returned an error: [${Array.from(new TextEncoder().encode('{"kind":"NotFound"}')).join(', ')}]` })],
  ])('is null for %s', (_name, err) => {
    expect(parseContractError(err)).toBeNull();
  });
});
