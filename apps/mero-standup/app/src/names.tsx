import { displayName } from "./lib/people";

/**
 * What to call `account`: the name they chose on this team, else a short id.
 *
 * v1 fell back to the name a person set for the whole namespace
 * (`@calimero-apps/names`, namespace member metadata). A component team lives
 * in an org, and an org has no shared name directory yet, so the team's own
 * `setName` is the name.
 */
export function PersonName({ account, name }: { account: string; name?: string | null }) {
  return <>{displayName(account, name)}</>;
}
