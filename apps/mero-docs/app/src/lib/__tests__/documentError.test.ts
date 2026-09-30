import { HTTPError, RpcError } from '@calimero-network/mero-js';
import { describe, expect, it } from 'vitest';
import {
  DOC_NOT_FOUND,
  DOC_NO_ACCESS,
  DOC_READ_ONLY,
  DOC_TOO_LARGE,
  DOC_UNREACHABLE,
  documentLoadErrorMessage,
  documentSaveErrorMessage,
} from '../documentError';

const httpError = (status: number) =>
  new HTTPError(status, 'x', 'http://node/jsonrpc', new Headers(), '{"error":"no"}');

/** The shape mero-js throws for a contract error: the type in `message`, the words in `data`. */
const contractError = (data: string) =>
  Object.assign(new Error('FunctionCallError'), { data, type: 'FunctionCallError' });

describe('documentLoadErrorMessage', () => {
  it('says a document the contract no longer holds is gone', () => {
    expect(documentLoadErrorMessage(contractError('not found: doc-1'))).toBe(DOC_NOT_FOUND);
  });

  it('says the same for a 404 from the node', () => {
    expect(documentLoadErrorMessage(httpError(404))).toBe(DOC_NOT_FOUND);
  });

  it.each([401, 403])('maps HTTP %i to access copy', (status) => {
    expect(documentLoadErrorMessage(httpError(status))).toBe(DOC_NO_ACCESS);
  });

  it.each([0, 500, 503])('maps HTTP %i to connection copy', (status) => {
    expect(documentLoadErrorMessage(httpError(status))).toBe(DOC_UNREACHABLE);
  });

  it('never shows the raw error type', () => {
    expect(documentLoadErrorMessage(contractError('boom'))).not.toContain('FunctionCallError');
  });
});

describe('documentSaveErrorMessage', () => {
  it('says an edit over the node limit is too large', () => {
    expect(documentSaveErrorMessage(httpError(413))).toBe(DOC_TOO_LARGE);
  });

  it('says a document deleted meanwhile is gone', () => {
    expect(documentSaveErrorMessage(contractError('not found: doc-1'))).toBe(DOC_NOT_FOUND);
  });

  it('tells a lapsed session apart from lost access', () => {
    expect(documentSaveErrorMessage(httpError(401))).toMatch(/sign in/i);
    expect(documentSaveErrorMessage(httpError(403))).toMatch(/can't edit/i);
  });

  it("says a Read only member's change was not kept", () => {
    const refused = new RpcError(-1, 'ReadOnlyWriteRefused', {}, 'ReadOnlyWriteRefused');
    expect(documentSaveErrorMessage(refused)).toBe(DOC_READ_ONLY);
  });

  it('falls back to plain copy', () => {
    expect(documentSaveErrorMessage(new Error('boom'))).toMatch(/couldn't be saved/);
  });
});
