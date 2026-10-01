/**
 * Links to a single message.
 *
 * # Why a position, not a message id
 *
 * The obvious anchor is the message id, and it is the wrong one. Ids exist to
 * be unique, not to be shared: they are derived from the message and, until
 * very recently, contained its plaintext verbatim — a link would have carried
 * the message into every proxy log, scanner and chat history that touched the
 * URL. That specific defect is fixed (ids are digests now), but the shape of
 * the argument survives it: an id is an opaque 75-character string that says
 * nothing about where the message is, so resolving one means searching for it.
 *
 * An absolute index is better on every axis that matters here. It is short, it
 * is derived from position rather than content so it discloses nothing, and it
 * is directly resolvable — `get_messages_from(index, …)` is the whole lookup.
 *
 * It is also stable, which is the property a link needs above all: appends land
 * after it, and a delete keeps its slot with the text blanked. An index handed
 * out today names the same message next year. (Pinned by the contract tests
 * around `get_messages_from`.)
 *
 * # The anchor we did NOT use, and when to reach for it
 *
 * A position is not an identity, and this design knows it: the id in the link
 * exists to catch the difference. The durable alternative is a key the message
 * carries for life — Slack (`p<ts>`) and Telegram (`/<message_id>`) both work
 * this way, with one server-assigned, immutable, monotonic value that is both
 * the identity AND the sort order, so a link needs nothing else.
 *
 * Two candidates were ruled out by testing rather than taste:
 *
 *  - The storage layer's element id (`AuthoredVector::push` returns one, and
 *    `get_by_id` resolves it) LOOKS like exactly that, and is not. Elements are
 *    inserted with a random id, and the deterministic re-key that makes
 *    independently-created collections converge rewrites those ids *derived
 *    from append position*. Pinned by `element_ids_do_not_survive_a_
 *    deterministic_rekey` in core's `authored_vector.rs`. Anchoring there would
 *    have been strictly worse than a position, because it looks stable.
 *
 *  - The message's `timestamp` is a sender wall-clock, so it is neither unique
 *    nor monotonic; one device with a bad clock breaks links.
 *
 * The option that remains is an app-assigned `(HybridTimestamp, seq)` stamped
 * in `send_message` and stored on the `Message`. Core already has every part —
 * `env::hlc_timestamp()`, a public `HybridTimestamp`, and `CharId` in the RGA
 * as a working precedent — so this is smaller than it sounds. It is ours, so no
 * re-key can rewrite it; it embeds the node id, so concurrent sends cannot
 * collide.
 *
 * Its real cost is that the message vector is ordered by CRDT insertion, NOT by
 * timestamp — verified by partitioning two nodes, where messages written offline
 * carried older timestamps and still landed after newer ones. So an HLC key
 * gives identity and a total order but not the DISPLAYED order, and using it to
 * seek would mean storing messages in a `SortedMap` keyed by it instead of a
 * vector. That is the actual work, not the stamping. (And any HLC stamping needs
 * the merge-mode guard the RGA's `insert` has: a node-local timestamp during a
 * migration mints a different key per node and diverges the network.)
 *
 * What should trigger the switch is not sync — positions were stable across
 * concurrent writes and a partition — but COMPACTION. Trimming history from the
 * start shifts every index at once and silently invalidates every link already
 * shared. If history is ever compacted, this anchor has to change first.
 *
 * # Shape
 *
 * Query parameters rather than a path, because the app is already reached
 * through them (`?context-id=`, `?node_url=`) and a link may have to survive a
 * redirect through the landing page, which forwards the query string.
 */

/** Query parameter naming the channel a linked message lives in. */
export const PERMALINK_CONTEXT_PARAM = "context-id";
/** Query parameter naming the message's absolute position in that channel. */
export const PERMALINK_MESSAGE_PARAM = "m";
/** Query parameter carrying the id of the message that position must hold. */
export const PERMALINK_ID_PARAM = "mid";

export interface MessageLink {
  contextId: string;
  index: number;
  /**
   * The id the message at `index` must have.
   *
   * The position is how the message is FOUND; this is how the app knows it
   * found the right one. Both are required: a position alone always resolves
   * to some message, so a stale link would open a different message with
   * nothing to indicate it — the one failure a permalink must never have.
   * Resolution has exactly three outcomes: the message, still loading, or an
   * error.
   *
   * Safe to put in a URL only because message ids are digests. While
   * `get_message_id` hex-encoded its input without hashing, an id in a link
   * would have carried the message text into every log that saw the URL.
   */
  messageId: string;
}

/**
 * A shareable link to one message.
 *
 * `origin` defaults to the running app so a link opens where it was made;
 * pass one explicitly to mint links for a public landing page.
 */
export function messagePermalink(
  link: MessageLink,
  origin: string = typeof window === "undefined" ? "" : window.location.origin,
): string {
  const params = new URLSearchParams();
  params.set(PERMALINK_CONTEXT_PARAM, link.contextId);
  params.set(PERMALINK_MESSAGE_PARAM, String(link.index));
  params.set(PERMALINK_ID_PARAM, link.messageId);
  return `${origin}/?${params.toString()}`;
}

/**
 * The message a URL points at, or `null` if it does not point at one.
 *
 * Strict about the index on purpose: a malformed or negative position is not
 * coerced to zero, which would silently open the top of the channel and look
 * like the link worked. Accepts a full URL or a bare query string.
 */
export function parseMessagePermalink(
  source: string | URLSearchParams,
): MessageLink | null {
  let params: URLSearchParams;
  if (source instanceof URLSearchParams) {
    params = source;
  } else {
    try {
      params = new URL(source, "http://localhost").searchParams;
    } catch {
      return null;
    }
  }

  const contextId = params.get(PERMALINK_CONTEXT_PARAM)?.trim();
  const rawIndex = params.get(PERMALINK_MESSAGE_PARAM);
  const messageId = params.get(PERMALINK_ID_PARAM)?.trim();
  if (!contextId || rawIndex === null || rawIndex.trim() === "") return null;
  // No id means the link cannot be checked, and an unverifiable message link is
  // not a message link — it is a link to a channel. Treated as such.
  if (!messageId) return null;

  // `Number` accepts "1e3" and " 12 "; a position is a plain integer.
  if (!/^\d+$/.test(rawIndex.trim())) return null;
  const index = Number(rawIndex.trim());
  if (!Number.isSafeInteger(index)) return null;

  return { contextId, index, messageId };
}

/** What a loaded window has to say about the message a link named. */
export type LinkResolution<M> =
  | { status: "found"; message: M }
  /** The position holds nothing — past the end, or history not synced here. */
  | { status: "missing" }
  /**
   * The position holds a DIFFERENT message than the link named.
   *
   * Deliberately distinct from `missing`: it means the channel shifted under a
   * link, which is a different thing to explain and the only case where the app
   * could plausibly have shown the wrong message.
   */
  | { status: "mismatch"; found: M };

/**
 * Decide whether a loaded window actually contains the linked message.
 *
 * The whole point of the id travelling in the link. A permalink has exactly
 * three honest outcomes — the message, still loading, or an error — and
 * "silently showed a different message" is not among them. Position alone
 * cannot tell those apart, because a position always resolves to something.
 */
export function resolveMessageLink<M extends { id: string; index?: number }>(
  messages: readonly M[],
  link: Pick<MessageLink, "index" | "messageId">,
): LinkResolution<M> {
  const atIndex = messages.find((m) => m.index === link.index);
  if (!atIndex) return { status: "missing" };
  if (atIndex.id !== link.messageId) return { status: "mismatch", found: atIndex };
  return { status: "found", message: atIndex };
}
