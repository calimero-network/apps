import { describe, it, expect } from 'vitest';
import { isTransportFailure } from '../transport';
import { contractErrorFixture, nodeError } from '@/lib/__tests__/contractErrorFixture';

describe('isTransportFailure', () => {
  it('calls a call the node never answered a transport failure', () => {
    expect(isTransportFailure(nodeError(0))).toBe(true);
  });

  it('calls a 503 a transport failure', () => {
    expect(isTransportFailure(nodeError(503))).toBe(true);
  });

  it('calls a failed fetch a transport failure', () => {
    expect(isTransportFailure(new TypeError('Failed to fetch'))).toBe(true);
  });

  it.each([403, 404, 413])('calls HTTP %s an answer', (status) => {
    expect(isTransportFailure(nodeError(status))).toBe(false);
  });

  it('calls the contract refusal an answer', () => {
    expect(isTransportFailure(contractErrorFixture('NotFound', 'x'))).toBe(false);
  });

  it('calls an unrelated error an answer', () => {
    expect(isTransportFailure(new Error('boom'))).toBe(false);
  });
});
