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
// The folder's group not existing on this node is a 404 too, and means the
// opposite: nothing about the caller, just governance that has not arrived.
export function isMemberGone(err: unknown): boolean {
  return err instanceof HTTPError && err.status === 404 && !isGroupNotOnNode(err);
}

// `group '<id>' not found`: the registry lists a folder whose group this node
// has not applied yet. Wait for sync; the caller is not refused.
export function isGroupNotOnNode(err: unknown): boolean {
  if (!(err instanceof HTTPError) || err.status !== 404) return false;
  const text = `${err.message} ${err.bodyText ?? ''}`;
  return /group '[^']*' not found/i.test(text);
}

// A revoked session also answers 403, but says nothing about membership.
export function isForbidden(err: unknown): boolean {
  return (
    err instanceof HTTPError &&
    !(err instanceof AuthRevokedError) &&
    err.status === 403
  );
}
