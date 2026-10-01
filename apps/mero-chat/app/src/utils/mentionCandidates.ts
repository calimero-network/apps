import { isSelfSender } from "./selfIdentity";

/**
 * The names worth offering after an `@`.
 *
 * Channel membership and mention candidates are nearly the same list, with one
 * difference: yourself. You belong in the member list — you are in the channel —
 * but `@` addresses someone else, and in a channel with two or three people an
 * entry for yourself is a meaningful fraction of the suggestions.
 *
 * `isSelfSender` is the app's existing answer to "is this me". It matters that
 * it, and not a string comparison, is used here: the roster reports accounts
 * while the app holds device keys and several encodings of both, so a direct
 * comparison silently matches nothing and quietly leaves you in the list.
 */
/**
 * The two reserved words that address the whole channel.
 *
 * They already worked — the contract's `get_unread_mentions` counts a message
 * carrying either as mentioning everybody — but nothing ever offered them, so
 * you had to know they existed and type them exactly. Listing them is the whole
 * difference between a feature that exists and one anybody uses.
 *
 * First in the list, at a fixed position: they do not belong to the roster, and
 * interleaving them alphabetically would move them every time membership
 * changed.
 */
const BROADCASTS = ["everyone", "here"];

export function mentionCandidates(
  members: Map<string, string> | undefined | null,
  contextId: string,
): string[] {
  const names: string[] = [...BROADCASTS];
  if (!members) return names;

  for (const [identity, name] of members) {
    if (!name.trim()) continue;
    if (isSelfSender(identity, contextId)) continue;
    // A member named "here" would otherwise appear twice.
    if (BROADCASTS.includes(name.trim().toLowerCase())) continue;
    names.push(name);
  }
  return names;
}
