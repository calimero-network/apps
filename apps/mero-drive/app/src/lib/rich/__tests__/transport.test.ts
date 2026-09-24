import { describe, it, expect } from 'vitest';
import { HTTPError, RpcError } from '@calimero-network/mero-react';
import { isTransportFailure } from '../transport';

describe('isTransportFailure', () => {
  it('calls a network-error HTTPError (status 0) a transport failure', () => {
    expect(
      isTransportFailure(new HTTPError(0, 'Network Error', 'http://x', new Headers(), '')),
    ).toBe(true);
  });

  it.each([502, 503, 504])('calls HTTP %s a transport failure', (status) => {
    expect(
      isTransportFailure(new HTTPError(status, 'Bad Gateway', 'http://x', new Headers(), '')),
    ).toBe(true);
  });

  it('calls a 4xx HTTPError an application error', () => {
    expect(
      isTransportFailure(new HTTPError(404, 'Not Found', 'http://x', new Headers(), '')),
    ).toBe(false);
  });

  it('calls a JSON-RPC error object an application error', () => {
    expect(isTransportFailure(new RpcError(-32000, 'block not found'))).toBe(false);
  });

  it('calls an unrelated error an application error', () => {
    expect(isTransportFailure(new Error('boom'))).toBe(false);
  });
});
