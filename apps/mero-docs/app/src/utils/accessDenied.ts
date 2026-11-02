import { AuthRevokedError, HTTPError } from '@/calimero/errors';

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

// A 404 for a capability read: the member is not in the folder (never was,
// removed, or a removal from an Open folder). v1 also answered 404 for a
// folder whose group had not reached this node yet; on 1.0 every node reads
// the same system state, so there is no such case.
export function isMemberGone(err: unknown): boolean {
  return err instanceof HTTPError && err.status === 404;
}

/** Always false on 1.0: kept for callers that waited out v1's replication. */
export function isGroupNotOnNode(_err: unknown): boolean {
  return false;
}

// A revoked session also answers 403, but says nothing about membership.
export function isForbidden(err: unknown): boolean {
  return (
    err instanceof HTTPError &&
    !(err instanceof AuthRevokedError) &&
    err.status === 403
  );
}
