import { describe, expect, it } from 'vitest';

import { describeError, isTransient, rawReason } from './errors';

/** What mero-js throws for a failed execute: the type as message, reason in data. */
function rpcError(data: unknown, type = 'FunctionCallError') {
  return Object.assign(new Error(type), { data, type });
}

const bytes = (text: string) =>
  JSON.stringify(Array.from(new TextEncoder().encode(text)));

describe('errors', () => {
  it("reads the contract's own message out of the byte list", () => {
    const e = rpcError(
      `the method call returned an error: ${bytes('"only a vault Admin can do that"')}`,
    );
    expect(describeError(e)).toBe('only a vault Admin can do that');
  });

  it('shows the reason, not the bare type', () => {
    const e = rpcError('Caller is not a member of this context');
    expect(rawReason(e)).toBe('Caller is not a member of this context');
    expect(describeError(e)).not.toBe('FunctionCallError');
  });

  it('marks node conditions that clear by themselves as transient', () => {
    expect(
      isTransient(rpcError('Caller is not a member of this context')),
    ).toBe(true);
    expect(isTransient(rpcError(null, 'Uninitialized'))).toBe(true);
    expect(isTransient(rpcError({ context_id: 'x' }, 'GroupKeyPending'))).toBe(
      true,
    );
    expect(
      isTransient(rpcError(`returned an error: ${bytes('"no such device"')}`)),
    ).toBe(false);
  });

  it('passes a plain error through', () => {
    expect(describeError(new Error('The two passphrases do not match.'))).toBe(
      'The two passphrases do not match.',
    );
    expect(describeError('boom')).toBe('boom');
  });
});
