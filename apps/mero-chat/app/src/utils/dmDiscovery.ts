import { sameAccount } from "./accountIdentity";

/**
 * Working out which conversations are DMs, and with whom, from membership.
 *
 * # Why not from a name
 *
 * A DM's subgroup used to be NAMED after its participants —
 * `DM_CONTEXT_<accountA>_<accountB>` — and the other side was recovered by
 * parsing that back. Two things were wrong with it.
 *
 * It did not work. `groupName` is capped at 64 bytes server-side and that alias
 * is 140, so the name was dropped on write, silently, with a 200 response.
 * Neither side could parse what was never stored, which is why a DM never
 * appeared for the person who did not create it.
 *
 * And it should not work. Putting both participants in a shared field means
 * anyone who can read that field learns who talks to whom — the pairing is the
 * sensitive part of a private conversation, more than the words in some
 * threat models. A design that only stays private because a length cap
 * happened to discard the data is not a design.
 *
 * Membership answers both questions and is already access-controlled: listing a
 * restricted subgroup's members returns 403 to non-members and 200 to members.
 * So "is this mine" is the call succeeding, and "who with" is the member that
 * is not me. Nothing has to be named, and nothing has to replicate.
 */

/**
 * The other participant, or `null` if this is not a DM I am part of.
 *
 * Comparisons go through `sameAccount` because the two halves come from
 * different places in different encodings: the members list is hex from the
 * admin API, while the identity being compared against is often base58 from the
 * contract. A raw `===` never matches, and every DM would look like someone
 * else's.
 */
export function resolveDmCounterpart(
  members: readonly string[],
  myAccount: string,
): string | null {
  if (!myAccount.trim()) return null;

  const present = members.filter((member) => member?.trim());
  if (present.length !== 2) return null;

  const others = present.filter((member) => !sameAccount(member, myAccount));

  // Exactly one must be me and one must not. Anything else — two of me, or
  // neither of me — is a group this logic should not draw a conclusion from.
  // Returning the wrong account here opens a conversation attributed to a
  // person who is not in it.
  if (others.length !== 1) return null;

  return others[0];
}

/**
 * Is this subgroup a DM of mine?
 *
 * `contextType` comes from the contract's `get_info` and is the authority: a
 * two-person CHANNEL is not a DM, and membership alone cannot tell them apart.
 * It is optional because it costs a contract call that may not have completed
 * when the list first paints — an unknown type is treated as a candidate, so
 * DMs appear promptly and a later type check can drop the ones that are not.
 */
export function isDmSubgroup(params: {
  members: readonly string[];
  myAccount: string;
  contextType?: string;
}): boolean {
  if (params.contextType && params.contextType !== "Dm") return false;
  return resolveDmCounterpart(params.members, params.myAccount) !== null;
}
