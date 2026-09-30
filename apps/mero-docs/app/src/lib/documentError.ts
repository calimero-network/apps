import { classifyError, RpcError } from '@calimero-network/mero-js';

// What to tell a person when a document fails to open or to save. The raw
// error ("FunctionCallError", "HTTP 413 Payload Too Large: …") is detail for
// the console, so callers log it and show this copy instead.

/**
 * The contract answers `get_doc` for an id it does not hold with an app error,
 * not an HTTP status: mero-js puts the type ("FunctionCallError") in `message`
 * and the contract's words ("not found: <id>") in `data`. So the text is read
 * from every field it can land in, like `isMissingOwnedIdentityError`.
 */
function mentionsNotFound(err: unknown): boolean {
  if (err == null) return false;
  const parts: string[] = [];
  if (err instanceof Error && err.message) parts.push(err.message);
  if (typeof err === 'object') {
    const o = err as Record<string, unknown>;
    for (const key of ['data', 'type', 'bodyText']) {
      if (typeof o[key] === 'string') parts.push(o[key] as string);
    }
  }
  return /\bnot found\b/i.test(parts.join(' | '));
}

export const DOC_NOT_FOUND =
  "This document doesn't exist anymore. It may have been deleted, or the link is out of date.";
export const DOC_NO_ACCESS = "You don't have access to this document.";
export const DOC_UNREACHABLE =
  "Couldn't reach your node. Check your connection and try again.";
export const DOC_TOO_LARGE =
  'This change is too large to save in one go. Try splitting the document, or removing a large paste.';

/** Copy for a document that failed to open. */
export function documentLoadErrorMessage(err: unknown): string {
  const { kind } = classifyError(err);
  // A 404 is the node not holding the docs context; the contract's own
  // "not found" is the document itself being gone. Either way it isn't there.
  if (kind === 'not-found' || mentionsNotFound(err)) return DOC_NOT_FOUND;
  if (kind === 'unauthorized' || kind === 'forbidden') return DOC_NO_ACCESS;
  if (kind === 'unreachable' || kind === 'unavailable' || kind === 'server') {
    return DOC_UNREACHABLE;
  }
  return "Couldn't open this document. Try refreshing the page.";
}

export const DOC_READ_ONLY = "You can only read this document, so your change wasn't kept.";

/** Core's typed answer to any state write by a ReadOnly member of the folder. */
export function isReadOnlyRefusal(err: unknown): boolean {
  return err instanceof RpcError && err.type === 'ReadOnlyWriteRefused';
}

/** Copy for an edit the node refused to save. */
export function documentSaveErrorMessage(err: unknown): string {
  if (isReadOnlyRefusal(err)) return DOC_READ_ONLY;
  const { kind } = classifyError(err);
  // The node caps a request body; one edit carrying a huge paste goes over it,
  // and sending the same edit again gets the same answer.
  if (kind === 'too-large') return DOC_TOO_LARGE;
  if (kind === 'not-found' || mentionsNotFound(err)) return DOC_NOT_FOUND;
  if (kind === 'unauthorized') {
    return 'Your session with your node has ended. Sign in again to keep saving.';
  }
  if (kind === 'forbidden') {
    return "You can't edit this document anymore, so your latest change wasn't saved.";
  }
  return "Your latest change couldn't be saved. Keep editing to try again, or refresh the page.";
}
