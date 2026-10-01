import { AuthRevokedError, HTTPError } from '@calimero-network/mero-js';

// Membership refusals, told apart from real faults by HTTP status so the UI can
// show a restricted state instead of a red error.

// get_group_info and list_group_members both refuse a non-member with a typed
// 403; a probe that failed any other way is confirmed against the latter.
export async function isGroupAccessDenied(
  admin: { listGroupMembers(groupId: string): Promise<unknown> },
  groupId: string,
  probeError: unknown,
): Promise<boolean> {
  if (isForbidden(probeError)) return true;
  return admin.listGroupMembers(groupId).then(() => false, isForbidden);
}

// Whether the selected folder shows the restricted card rather than its docs.
export function lacksFolderAccess(perms: {
  isMember: boolean;
  error: Error | null;
  denied: boolean;
}): boolean {
  if (!perms.error) return !perms.isMember;
  return perms.denied || isForbidden(perms.error);
}

// Core answers 404 for a capability read of someone removed from an Open folder.
export function isMemberGone(err: unknown): boolean {
  return err instanceof HTTPError && err.status === 404;
}

// A revoked session also answers 403, but says nothing about membership.
export function isForbidden(err: unknown): boolean {
  return (
    err instanceof HTTPError &&
    !(err instanceof AuthRevokedError) &&
    err.status === 403
  );
}
