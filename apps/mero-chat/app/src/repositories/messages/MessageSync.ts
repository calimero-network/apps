/**
 * Reconciling a locally-stored channel with the node.
 *
 * # Why a live socket is not enough
 *
 * A socket only tells you what happened while you were listening. Close the tab
 * for two hours and the events for those two hours are not queued anywhere —
 * they were broadcast and missed. An app that treats the socket as its source
 * of truth comes back showing a conversation that stops where the last session
 * did, and nothing in it knows that is wrong.
 *
 * So the socket is an optimisation for latency, never the way history is
 * learned. History is reconciled explicitly, on every open and every reconnect,
 * against a cursor the client persisted.
 *
 * # Why an absolute index is the cursor
 *
 * `get_messages` counts its window from the END, so an offset stored earlier
 * names different messages once anything is appended. Absolute indices from the
 * start do not move: appends land after them, and a delete keeps its slot with
 * the text blanked. `get_messages_from(n)` therefore means the same thing
 * whenever it is asked, which is what lets a cursor survive being closed.
 *
 * A timestamp would not do: two nodes clock messages independently, so
 * "everything after 14:32" is ambiguous across peers in a way a position is not.
 */

export interface ChannelCursor {
  contextId: string;
  /** Highest index held locally and contiguous from `lowestIndex`. */
  highestIndex: number;
  /** Lowest index held locally; where backfill continues from. */
  lowestIndex: number;
  /** Channel length as of the last reconcile — how far behind we knew we were. */
  knownTotal: number;
}

export interface MessagePage<M> {
  messages: M[];
  totalCount: number;
}

export interface MessageSource<M> {
  /** `get_messages_from` — ascending from an absolute index. */
  range(contextId: string, start: number, limit: number): Promise<MessagePage<M>>;
  /** `get_message_count` — one row read, no message bodies. */
  count(contextId: string): Promise<number>;
}

export interface MessageStore<M> {
  /** Ascending window from local storage. */
  read(contextId: string, start: number, limit: number): Promise<M[]>;
  put(contextId: string, messages: M[]): Promise<void>;
  cursor(contextId: string): Promise<ChannelCursor | undefined>;
  saveCursor(cursor: ChannelCursor): Promise<void>;
}

export interface CatchUpResult {
  /** Messages newly written to the store. */
  fetched: number;
  /** True when the local copy was already current. */
  upToDate: boolean;
}

/** How many messages one catch-up request asks for. */
export const CATCH_UP_PAGE = 100;

/**
 * Limit on a single catch-up, so a client returning after a very long absence
 * does not block the first paint fetching thousands of messages.
 *
 * The remainder is not lost — it is older than what was just fetched, so it sits
 * below the local window and is reached by the same backfill that scrolling up
 * uses. Being behind is a normal state here, not an error.
 */
export const MAX_CATCH_UP_PAGES = 5;

export class MessageSyncEngine<M extends { index: number; id?: string }> {
  /**
   * Backfills in flight, keyed by channel and anchor.
   *
   * A scroll to the top can fire the "load older" signal more than once before
   * the first load resolves, and both calls then read the same anchor and fetch
   * the same range. Sharing the promise makes the duplicate free instead of a
   * second round trip.
   */
  private readonly inFlight = new Map<string, Promise<M[]>>();

  /**
   * `contextId:messageId` → absolute index, for messages this engine has seen.
   *
   * A reaction event names a message, and the store is keyed by position, so
   * something has to bridge the two. This does, in memory and for free: every
   * path that yields messages already has both halves in hand.
   *
   * Deliberately NOT persisted. The row on disk is sealed precisely so a
   * message's content does not sit in plaintext, and an id-to-position table
   * beside it would describe the same conversation in the clear. The cost of
   * keeping it in memory is that a reload starts empty — handled by falling
   * back to a bounded window refresh rather than by weakening the store.
   */
  private readonly indexById = new Map<string, number>();

  private remember(contextId: string, messages: readonly M[]): void {
    for (const message of messages) {
      if (message.id) {
        this.indexById.set(`${contextId}:${message.id}`, message.index);
      }
    }
  }

  constructor(
    private readonly store: MessageStore<M>,
    private readonly source: MessageSource<M>,
  ) {}

  /**
   * Bring the local copy forward to the node's current end.
   *
   * Asks for the length first: one row read that answers "am I behind, and by
   * how much" without transferring a single message body. A client that is
   * current — the common case on a reconnect — costs exactly that and stops.
   */
  async catchUp(contextId: string): Promise<CatchUpResult> {
    const cursor = await this.store.cursor(contextId);
    const total = await this.source.count(contextId);

    // Nothing stored: this is a first visit, and the newest page is what the
    // user wants to see. Backfill reaches the rest.
    if (!cursor) {
      const start = Math.max(0, total - CATCH_UP_PAGE);
      const page = await this.source.range(contextId, start, CATCH_UP_PAGE);
      await this.store.put(contextId, page.messages);
      this.remember(contextId, page.messages);
      await this.store.saveCursor({
        contextId,
        lowestIndex: start,
        highestIndex: Math.max(start, total - 1),
        knownTotal: page.totalCount,
      });
      return { fetched: page.messages.length, upToDate: true };
    }

    const nextWanted = cursor.highestIndex + 1;
    if (nextWanted >= total) {
      await this.store.saveCursor({ ...cursor, knownTotal: total });
      return { fetched: 0, upToDate: true };
    }

    // Walk forward from exactly where the local copy ends. No overlap to
    // deduplicate and no gap to detect: the cursor is contiguous by
    // construction, so "everything after n" is precisely what was missed.
    let cursorIndex = nextWanted;
    let fetched = 0;
    let pages = 0;

    while (cursorIndex < total && pages < MAX_CATCH_UP_PAGES) {
      const page = await this.source.range(contextId, cursorIndex, CATCH_UP_PAGE);
      if (page.messages.length === 0) break;

      await this.store.put(contextId, page.messages);
      this.remember(contextId, page.messages);
      fetched += page.messages.length;
      cursorIndex = Math.max(...page.messages.map((m) => m.index)) + 1;
      pages += 1;
    }

    await this.store.saveCursor({
      ...cursor,
      highestIndex: cursorIndex - 1,
      knownTotal: total,
    });

    return { fetched, upToDate: cursorIndex >= total };
  }

  /**
   * How much of a channel is held locally, and how much is known to exist.
   *
   * Exposed so a view can answer "is there more to scroll to" from the cursor
   * rather than by keeping its own parallel count, which is how the two drift.
   */
  cursor(contextId: string): Promise<ChannelCursor | undefined> {
    return this.store.cursor(contextId);
  }

  /**
   * The newest stored messages: what a channel paints with on open.
   *
   * Reads local storage only, and never the node. That is deliberate — it is
   * what lets the first paint happen before any request completes, and what
   * makes an offline reopen show the conversation instead of an empty screen.
   * Freshness is `catchUp`'s job, and the two are meant to run in that order:
   * paint what is known, then reconcile.
   */
  async newest(contextId: string, limit: number): Promise<M[]> {
    const cursor = await this.store.cursor(contextId);
    if (!cursor) return [];
    const start = Math.max(cursor.lowestIndex, cursor.highestIndex - limit + 1);
    const stored = await this.store.read(
      contextId,
      start,
      cursor.highestIndex - start + 1,
    );
    this.remember(contextId, stored);
    return stored;
  }

  /**
   * Re-read messages the store already holds.
   *
   * `catchUp` walks FORWARD from the cursor and stops as soon as nothing is
   * newer. That is right for appends, and wrong for the one thing in a chat
   * that is not an append: a reaction changes an EXISTING message without
   * changing the count, so `catchUp` asks for the length, sees no gap, fetches
   * nothing, and the stored copy keeps its old reactions for as long as the
   * channel stays open.
   *
   * Reactions arrive inside `MessageWithReactions`, so refreshing the message
   * refreshes them. Bounded to the newest `limit` because that is where
   * reactions land — dragging the whole history back for one emoji would undo
   * the point of storing it.
   *
   * Deliberately writes through the node rather than reading the store first:
   * serving the local copy is exactly the staleness this exists to clear.
   */
  async refreshNewest(contextId: string, limit: number): Promise<M[]> {
    const cursor = await this.store.cursor(contextId);
    if (!cursor) return [];

    const start = Math.max(cursor.lowestIndex, cursor.highestIndex - limit + 1);
    const wanted = cursor.highestIndex - start + 1;
    if (wanted <= 0) return [];

    const page = await this.source.range(contextId, start, wanted);
    await this.store.put(contextId, page.messages);
    this.remember(contextId, page.messages);
    return page.messages;
  }

  /**
   * Re-read ONE message, named by its id.
   *
   * This is what a reaction event asks for. `refreshNewest` answers "something
   * near the bottom changed" and is wrong for anything else: react to a message
   * far enough up and it is not in the refreshed window, so nothing merges and
   * nothing re-renders. The result looks intermittent — it works or not
   * depending on how far the message has scrolled — which is worse than a
   * clean failure, because it reads as flakiness rather than as a bug.
   *
   * Falls back to a bounded window when the id is unknown, which is the state
   * after a reload: the rows are on disk but their ids are not (see
   * `indexById`). Refreshing the window is strictly better than doing nothing
   * and cannot cost more than one page.
   *
   * Returns the refreshed message, or null when it could not be found — an
   * honest null rather than some other message.
   */
  async refreshMessage(
    contextId: string,
    messageId: string,
    fallbackLimit = 20,
  ): Promise<M | null> {
    const known = this.indexById.get(`${contextId}:${messageId}`);

    if (known !== undefined) {
      const page = await this.source.range(contextId, known, 1);
      if (page.messages.length === 0) return null;
      await this.store.put(contextId, page.messages);
      this.remember(contextId, page.messages);
      return page.messages.find((m) => m.id === messageId) ?? null;
    }

    const window = await this.refreshNewest(contextId, fallbackLimit);
    return window.find((m) => m.id === messageId) ?? null;
  }

  /**
   * Older messages, for scrolling up.
   *
   * Local storage answers first, and the node is asked only when the local copy
   * runs out. That is what makes a reopened channel scroll instantly through
   * history it already holds instead of re-fetching what is already on disk.
   *
   * `before` is the position to walk back from, and the caller must pass the
   * oldest message it is DISPLAYING. It defaults to the store's low-water mark,
   * which is a different thing: a catch-up can leave the store holding far more
   * than the view is showing, and continuing from the store's bound would then
   * hand back a block of messages that does not join onto what is on screen —
   * a silent hole in the middle of the conversation.
   */
  loadOlder(contextId: string, limit: number, before?: number): Promise<M[]> {
    const key = `${contextId}:${before ?? "bound"}:${limit}`;
    const existing = this.inFlight.get(key);
    if (existing) return existing;

    const run = this.readOlder(contextId, limit, before).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, run);
    return run;
  }

  private async readOlder(
    contextId: string,
    limit: number,
    before?: number,
  ): Promise<M[]> {
    const cursor = await this.store.cursor(contextId);
    if (!cursor) return [];

    const from = before ?? cursor.lowestIndex;
    if (from <= 0) return [];

    const start = Math.max(0, from - limit);
    const wanted = from - start;

    // The cursor's low bound only ever falls: it describes how much contiguous
    // history the store holds, which reading older messages can extend but
    // never shrink.
    const widen = { ...cursor, lowestIndex: Math.min(cursor.lowestIndex, start) };

    // The node answers the read. The store may accelerate a paint; it may not
    // BE the answer.
    //
    // It held that authority until now, and that is what made an edit or a
    // reaction on an old message invisible: a stored row freezes its content at
    // write time, and nothing re-read it. `catchUp` could not help — it walks
    // forward from the cursor and only ever learns about appends.
    //
    // The cost is one page fetch per scroll-back, which is what the app did
    // before history was stored at all. What storing history buys is the first
    // paint and the offline case below, not fewer reads.
    try {
      const page = await this.source.range(contextId, start, wanted);
      await this.store.put(contextId, page.messages);
      await this.store.saveCursor(widen);
      this.remember(contextId, page.messages);
      return page.messages;
    } catch (error) {
      // Unreachable node: fall back to whatever was stored. This is the case
      // the store exists for, and a stale page beats an empty one.
      const local = await this.store.read(contextId, start, wanted);
      if (local.length === 0) throw error;
      await this.store.saveCursor(widen);
      this.remember(contextId, local);
      return local;
    }
  }

  /**
   * The messages surrounding a position, for opening a link to one.
   *
   * A permalink names a message that is almost never in the newest page, so
   * arriving at one is not "catch up" and not "scroll back" — it is a jump to
   * an arbitrary point with enough context on both sides to read. Storage
   * answers where it can, and whatever is fetched is written down, so a second
   * visit to the same link costs nothing.
   *
   * The cursor is deliberately NOT moved here. It describes the contiguous
   * run of history the channel has loaded from its newest end; a window
   * plucked from the middle does not extend that run, and claiming it did
   * would tell a later backfill that a gap it never filled is already covered.
   */
  async loadAround(
    contextId: string,
    index: number,
    radius: number,
  ): Promise<M[]> {
    const start = Math.max(0, index - radius);
    const wanted = index + radius + 1 - start;

    const local = await this.store.read(contextId, start, wanted);
    if (local.length === wanted) {
      this.remember(contextId, local);
      return local;
    }

    // A short local read is not proof the node has more: near the end of a
    // channel the window legitimately runs past the last message.
    const page = await this.source.range(contextId, start, wanted);
    await this.store.put(contextId, page.messages);
    this.remember(contextId, page.messages);
    return page.messages;
  }

  /**
   * Apply a live event.
   *
   * Only when it lands exactly where the local copy ends. An event arriving
   * ahead of the cursor means something was missed in between — the socket
   * dropped, or delivery raced — and writing it would leave a hole that no
   * later read could see, because the cursor would then claim contiguity it
   * does not have. Reconciling instead is a round trip; a silent hole in the
   * history is forever.
   */
  async applyLive(contextId: string, message: M): Promise<"applied" | "resynced"> {
    const cursor = await this.store.cursor(contextId);
    if (!cursor) {
      await this.catchUp(contextId);
      return "resynced";
    }

    if (message.index !== cursor.highestIndex + 1) {
      await this.catchUp(contextId);
      return "resynced";
    }

    await this.store.put(contextId, [message]);
    this.remember(contextId, [message]);
    await this.store.saveCursor({
      ...cursor,
      highestIndex: message.index,
      knownTotal: Math.max(cursor.knownTotal, message.index + 1),
    });
    return "applied";
  }
}
