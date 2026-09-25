import { isSelfSender } from "./selfIdentity";

/** The two reserved words that address the whole channel. */
const BROADCASTS = new Set(["everyone", "here"]);

/**
 * Does this message mention me — directly, or by addressing the channel?
 *
 * # Why the client has to decide this
 *
 * The contract already answers it in aggregate: `get_unread_mentions` counts a
 * message when any of `mentions_usernames` is `everyone`/`here`, or when the
 * caller's account is in `mentions`. That drives the channel's mention badge.
 *
 * But a count cannot tell you that *this* arriving message is the one, and the
 * notification path needs exactly that — a mention should announce itself as
 * one rather than arriving as another anonymous "new message". So the same rule
 * is applied here, per message.
 *
 * Kept deliberately identical to the contract's: if the two disagree, a badge
 * appears with no notification, or a notification fires with no badge, and
 * either reads as a bug.
 *
 * `mentions` holds ACCOUNTS, so `isSelfSender` does the comparison — the app
 * holds device keys in several encodings and a direct string compare matches
 * nothing.
 */
export function messageMentionsMe(
  message: { mentions?: string[]; mentions_usernames?: string[] },
  contextId: string,
): boolean {
  // `mentions_usernames` carries ordinary display names too, so match the
  // reserved words exactly — a member called "Everyone Else" must not be able
  // to alert the whole channel by existing.
  for (const name of message.mentions_usernames ?? []) {
    if (BROADCASTS.has(name.trim().toLowerCase())) return true;
  }

  for (const account of message.mentions ?? []) {
    if (isSelfSender(account, contextId)) return true;
  }

  return false;
}
