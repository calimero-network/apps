// Classify errors coming out of admin-api / RPC calls into "you
// don't have access to this resource" vs everything else.
//
// The node surfaces membership-gated endpoints with 500 + a body
// like `identity is not a member of group '...'`. Other 500s (real
// node errors, bad payloads, transient network) have different
// bodies. Treating the membership-denial as its own category lets
// the UI show a friendly "Restricted folder" card rather than a
// scary red error message.

function extractErrorText(err: unknown): string {
  if (!err) return '';
  // mero-js throws `HTTPError` with `status`, `statusText`, `bodyText`.
  // The underlying node response for membership-gated endpoints has
  // the real reason in `bodyText` (e.g. `{"error":"identity is not a
  // member of group '...'"}`). Include it in the scan so generic
  // Error.message strings don't mask the signal.
  if (typeof err === 'object' && err !== null) {
    const maybeHttp = err as {
      message?: unknown;
      bodyText?: unknown;
      statusText?: unknown;
    };
    const parts: string[] = [];
    if (typeof maybeHttp.message === 'string') parts.push(maybeHttp.message);
    if (typeof maybeHttp.bodyText === 'string') parts.push(maybeHttp.bodyText);
    if (typeof maybeHttp.statusText === 'string')
      parts.push(maybeHttp.statusText);
    if (parts.length > 0) return parts.join(' | ');
  }
  return err instanceof Error ? err.message : String(err);
}

export function isAccessDeniedError(err: unknown): boolean {
  if (!err) return false;
  const lower = extractErrorText(err).toLowerCase();
  return (
    lower.includes('not a member') ||
    lower.includes('forbidden') ||
    lower.includes('permission denied') ||
    // JSON-RPC FunctionCallError with a permission-related message.
    // Checking for functioncallerror alone would match unrelated WASM
    // panics (business logic errors, serialisation failures) and mask
    // them behind a misleading "Restricted folder" card.
    (lower.includes('functioncallerror') &&
      (lower.includes('permission') || lower.includes('not a member')))
  );
}
