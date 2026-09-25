import { describe, it, expect } from 'vitest';
import { describeError, bytesToText } from './errors';

// A representative payload the node returns for a denied owner-gated delete:
// the ASCII byte array of `{"data":"delete: caller is not the owner","kind":"Forbidden"}`.
const DELETE_BYTES = [123, 34, 100, 97, 116, 97, 34, 58, 34, 100, 101, 108, 101, 116, 101, 58, 32, 99, 97, 108, 108, 101, 114, 32, 105, 115, 32, 110, 111, 116, 32, 116, 104, 101, 32, 111, 119, 110, 101, 114, 34, 44, 34, 107, 105, 110, 100, 34, 58, 34, 70, 111, 114, 98, 105, 100, 100, 101, 110, 34, 125];

describe('describeError', () => {
  it('passes through plain strings', () => {
    expect(describeError('boom')).toBe('boom');
  });

  it('handles null/undefined', () => {
    expect(describeError(null)).toBe('Unknown error');
    expect(describeError(undefined)).toBe('Unknown error');
  });

  it('uses Error.message', () => {
    expect(describeError(new Error('nope'))).toBe('nope');
  });

  it('appends contract detail from RpcError.data ({kind,data} shape)', () => {
    const rpc = {
      name: 'RpcError',
      message: 'FunctionCallError',
      data: { kind: 'Forbidden', data: 'delete: caller is not the owner' },
    };
    const out = describeError(rpc);
    expect(out).toContain('FunctionCallError');
    expect(out).toContain('Forbidden');
    expect(out).toContain('caller is not the owner');
  });

  it('does not duplicate detail already in the message', () => {
    const rpc = { message: 'Forbidden: x', data: 'Forbidden: x' };
    expect(describeError(rpc)).toBe('Forbidden: x');
  });

  it('falls back to a string data payload', () => {
    expect(describeError({ message: '', data: 'raw detail' })).toBe('raw detail');
  });

  it('falls back to the error type when nothing else is present', () => {
    expect(describeError({ type: 'TimeoutError' })).toBe('TimeoutError');
  });

  it('stringifies an unknown object payload', () => {
    const out = describeError({ message: 'wrap', data: { foo: 'bar' } });
    expect(out).toContain('wrap');
    expect(out).toContain('bar');
  });

  it('bytesToText decodes ASCII codes', () => {
    expect(bytesToText(DELETE_BYTES)).toBe(
      '{"data":"delete: caller is not the owner","kind":"Forbidden"}',
    );
  });

  it('decodes a byte-array payload in the message wrapper', () => {
    const msg = `the method call returned an error: ${JSON.stringify(DELETE_BYTES)}`;
    expect(describeError(msg)).toBe('Forbidden: delete: caller is not the owner');
  });

  it('decodes a byte-array payload in RpcError.data', () => {
    const out = describeError({ message: 'FunctionCallError', data: DELETE_BYTES });
    expect(out).toContain('Forbidden');
    expect(out).toContain('delete: caller is not the owner');
  });

  it('passes plain messages through untouched', () => {
    expect(describeError('the method call returned an error: boom')).toBe(
      'the method call returned an error: boom',
    );
  });
});
