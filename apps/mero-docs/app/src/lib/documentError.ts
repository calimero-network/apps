import { classifyError, isReadOnlyWrite } from '@/calimero/errors';
import { parseContractError } from './contractError';

// What to tell a person when a document fails to open or to save. The raw
// error ("FunctionCallError", "HTTP 413 Payload Too Large: …") is detail for
// the console, so callers log it and show this copy instead.

export const DOC_NOT_FOUND =
  "This document doesn't exist anymore. It may have been deleted, or the link is out of date.";
export const DOC_NO_ACCESS = "You don't have access to this document.";
export const DOC_UNREACHABLE =
  "Couldn't reach Calimero. Check your connection and try again.";
export const DOC_TOO_LARGE =
  'This change is too large to save in one go. Try splitting the document, or removing a large paste.';

/** Copy for a document that failed to open. */
export function documentLoadErrorMessage(err: unknown): string {
  const { kind } = classifyError(err);
  const refusal = parseContractError(err)?.kind;
  // A 404 is the caller not reaching the folder's docs instance; the contract's own
  // NotFound is the document itself being gone. Either way it isn't there.
  if (kind === 'not-found' || refusal === 'NotFound') return DOC_NOT_FOUND;
  if (kind === 'unauthorized' || kind === 'forbidden' || refusal === 'Forbidden') {
    return DOC_NO_ACCESS;
  }
  if (kind === 'unreachable' || kind === 'unavailable' || kind === 'server') {
    return DOC_UNREACHABLE;
  }
  return "Couldn't open this document. Try refreshing the page.";
}

export const DOC_READ_ONLY = "You can only read this document, so your change wasn't kept.";

/** The node's answer to any write by a member whose row in the folder's team is read-only. */
export function isReadOnlyRefusal(err: unknown): boolean {
  return isReadOnlyWrite(err);
}

/** Copy for an edit the node refused to save. */
export function documentSaveErrorMessage(err: unknown): string {
  if (isReadOnlyRefusal(err)) return DOC_READ_ONLY;
  const { kind } = classifyError(err);
  const refusal = parseContractError(err)?.kind;
  // The node caps a request body; one edit carrying a huge paste goes over it,
  // and sending the same edit again gets the same answer.
  if (kind === 'too-large') return DOC_TOO_LARGE;
  if (kind === 'not-found' || refusal === 'NotFound') return DOC_NOT_FOUND;
  if (kind === 'unauthorized') {
    return 'Your session has ended. Sign in again to keep saving.';
  }
  if (kind === 'forbidden' || refusal === 'Forbidden') {
    return "You can't edit this document anymore, so your latest change wasn't saved.";
  }
  return "Your latest change couldn't be saved. Keep editing to try again, or refresh the page.";
}
