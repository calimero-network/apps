import type { RepositoryPolicy } from "../core/types";

/**
 * Policy for message bodies.
 *
 * The interesting decision here is `persist`, and it is a privacy decision
 * rather than a performance one.
 *
 * - `persist: true` — **the most important line in this file, and it was `false`
 *   until the storage underneath it changed.** The objection was never "history
 *   on disk is wrong"; it was that `localStorage` writes conversations in
 *   plaintext, readable by anyone with the device or a copy of the profile, and
 *   surviving logout. `IndexedDbMessageStore` removes exactly those three:
 *   bodies are AES-GCM sealed under a non-extractable key, a stolen disk yields
 *   ciphertext, and `destroyAtRestKey` makes every stored message unreadable in
 *   one write.
 *
 *   What it does NOT remove: script on this origin can decrypt, because it must
 *   be able to in order to render. An XSS reads the history. No browser storage
 *   defends against that, and the honest framing is that this protects the disk,
 *   not the page.
 *
 *   The reason to accept that trade is that the alternative was not "no history
 *   on disk" — it was refetching the entire visible conversation from the node
 *   on every reload, which is what made the app feel like a web page instead of
 *   a chat client. History is reconciled by `MessageSyncEngine` against the
 *   stored cursor; this store is what makes that cursor mean anything.
 *
 * - `ttlMs: 30 s` — messages are mutable (edited, deleted, reacted to) but
 *   changes arrive as events, and the event handlers invalidate directly. The
 *   TTL is a backstop for a missed event, not the primary freshness mechanism,
 *   so it can be short without being chatty.
 *
 * - `staleWhileRevalidate: true` — showing the conversation you were just
 *   reading while a refresh lands is right; blanking it is not.
 *
 * - `negativeTtlMs: 0` — "this message does not exist" is not worth
 *   remembering. A message id that resolves to nothing is either a deletion
 *   (which arrives as an event) or a sync gap that will close on its own, and
 *   caching the absence would keep it hidden after it arrives.
 */
export const MESSAGE_POLICY: RepositoryPolicy = {
  ttlMs: 30 * 1000,
  staleWhileRevalidate: true,
  persist: true,
  negativeTtlMs: 0,
};
