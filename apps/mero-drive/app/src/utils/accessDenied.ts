import { AuthRevokedError, HTTPError } from '@calimero-network/mero-js';

// Membership refusals, told apart from real faults by HTTP status so the UI can
// show a restricted state instead of a red error.

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

// Whether the selected folder shows the restricted card rather than its docs.
export function lacksFolderAccess(perms: {
  isMember: boolean;
  error: Error | null;
}): boolean {
  return perms.error ? isForbidden(perms.error) : !perms.isMember;
}

// A revoked session also answers 403, but says nothing about membership.
function isForbidden(err: unknown): boolean {
  return (
    err instanceof HTTPError &&
    !(err instanceof AuthRevokedError) &&
    err.status === 403
  );
}
