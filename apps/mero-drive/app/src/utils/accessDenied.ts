import { AuthRevokedError, HTTPError } from '@calimero-network/mero-js';

// Membership-refusal checks for admin-api / RPC errors, so the UI can show a
// restricted state instead of a red error.

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

// get_group_info refuses a non-member with an untyped 500, so a failed probe is
// confirmed against list_group_members, which refuses it with a 403.
export async function isGroupAccessDenied(
  admin: { listGroupMembers(groupId: string): Promise<unknown> },
  groupId: string,
  probeError: unknown,
): Promise<boolean> {
  if (isForbidden(probeError)) return true;
  return admin.listGroupMembers(groupId).then(() => false, isForbidden);
}

// A revoked session also answers 403, but says nothing about membership.
function isForbidden(err: unknown): boolean {
  return (
    err instanceof HTTPError &&
    !(err instanceof AuthRevokedError) &&
    err.status === 403
  );
}
