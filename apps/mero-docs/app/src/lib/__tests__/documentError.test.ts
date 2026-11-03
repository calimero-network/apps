import { describe, expect, it } from 'vitest';
import { contractErrorFixture, nodeError } from './contractErrorFixture';
import {
  DOC_NOT_FOUND,
  DOC_NO_ACCESS,
  DOC_READ_ONLY,
  DOC_TOO_LARGE,
  DOC_UNREACHABLE,
  documentLoadErrorMessage,
  documentSaveErrorMessage,
} from '../documentError';

const httpError = nodeError;

describe('documentLoadErrorMessage', () => {
  it('says a document the contract no longer holds is gone', () => {
    expect(documentLoadErrorMessage(contractErrorFixture('NotFound', 'doc-1'))).toBe(DOC_NOT_FOUND);
  });

  it('says a refused read is no access', () => {
    expect(documentLoadErrorMessage(contractErrorFixture('Forbidden', 'x'))).toBe(DOC_NO_ACCESS);
  });

  it('does not read prose as a not-found answer', () => {
    expect(documentLoadErrorMessage(new Error('not found: doc-1'))).not.toBe(DOC_NOT_FOUND);
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
    expect(documentLoadErrorMessage(contractErrorFixture('Invalid', 'boom'))).not.toContain('APP_ERROR');
  });
});

describe('documentSaveErrorMessage', () => {
  it('says an edit over the node limit is too large', () => {
    expect(documentSaveErrorMessage(httpError(413))).toBe(DOC_TOO_LARGE);
  });

  it('says a document deleted meanwhile is gone', () => {
    expect(documentSaveErrorMessage(contractErrorFixture('NotFound', 'doc-1'))).toBe(DOC_NOT_FOUND);
  });

  it('says a write the contract refused is not allowed', () => {
    expect(documentSaveErrorMessage(contractErrorFixture('Forbidden', 'x'))).toMatch(/can't edit/i);
  });

  it('tells a lapsed session apart from lost access', () => {
    expect(documentSaveErrorMessage(httpError(401))).toMatch(/sign in/i);
    expect(documentSaveErrorMessage(httpError(403))).toBe(DOC_READ_ONLY);
  });

  it("says a Read only member's change was not kept", () => {
    // The node refuses a write by a read-only team row with 403.
    expect(documentSaveErrorMessage(nodeError(403))).toBe(DOC_READ_ONLY);
  });

  it('falls back to plain copy', () => {
    expect(documentSaveErrorMessage(new Error('boom'))).toMatch(/couldn't be saved/);
  });
});
