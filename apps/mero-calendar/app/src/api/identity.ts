/**
 * Who this session acts as: the signed-in ACCOUNT (`client.session.accountId`),
 * the id the contract stores as an event's `owner` and in `peers`, and the id
 * the organization's member list is keyed by. Kept here for the components
 * that gate Edit and Delete on ownership without a hook.
 *
 * "" means unknown, which owns nothing: the contract is the real gate either
 * way (`updateEvent` and `deleteEvent` refuse anyone but the owner).
 */
let current = "";

export function accountId(): string {
  return current;
}

export function setAccountId(id: string): void {
  current = id.trim();
}

/** Test seam. */
export function resetAccountId(): void {
  current = "";
}
