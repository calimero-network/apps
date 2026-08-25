import type { RepositoryPolicy } from "../core/types";

/**
 * Policy for a message's reactions — emoji → the ACCOUNTS that reacted.
 *
 * - `persist: false` — the same reasoning as message bodies. Who reacted to
 *   what, and with what, is conversation content: it reveals participants and
 *   sentiment even without the message text beside it. It does not belong in
 *   plaintext on disk.
 *
 * - `ttlMs: 15 s` — shorter than messages because reactions are the most
 *   frequently mutated thing in a conversation and the cheapest to refetch.
 *   As with messages the real freshness path is the `ReactionUpdated` event,
 *   which invalidates the message's entry directly; the TTL only covers a
 *   missed event.
 *
 * - `staleWhileRevalidate: true` — a reaction count one moment out of date is
 *   invisible to the user; a pill that vanishes and reappears is not.
 *
 * - `negativeTtlMs: 10 s` — most messages have no reactions at all, so the
 *   empty answer is the common one and worth holding briefly. Short, because
 *   the first reaction on a message should show up promptly.
 *
 * Note what is NOT in this policy: nothing about names. Reactions are stored
 * and compared as accounts, and the name repository resolves them for display.
 * Keying them by name meant a rename split your own reaction and two members
 * sharing a name could remove each other's.
 */
export const REACTION_POLICY: RepositoryPolicy = {
  ttlMs: 15 * 1000,
  staleWhileRevalidate: true,
  persist: false,
  negativeTtlMs: 10 * 1000,
};
