import { openDb } from "../core/db";
import { seal, unseal, type Sealed } from "../core/crypto";
import type { ChannelCursor, MessageStore } from "./MessageSync";

/**
 * Durable, encrypted message history.
 *
 * # What is encrypted and what is not
 *
 * The message body is sealed; its channel and its position are not. That is a
 * deliberate split, not an oversight: `byContextIndex` is what turns "give me
 * the twenty messages before index 100" into a bounded cursor walk instead of
 * decrypting every row in the database to find out which ones were wanted.
 * Encrypting the key would cost exactly the property that makes local history
 * worth keeping.
 *
 * So what a disk-level attacker learns is that a channel exists and how many
 * messages it holds — the same shape the node's own storage reveals — and not
 * a word of what was said. See `core/crypto.ts` for what the at-rest key does
 * and does not defend against.
 *
 * # Why rows are never rewritten wholesale
 *
 * Unlike the name cache, the caller does not own the full set here: history is
 * accumulated across sessions and is far larger than what is resident. Writes
 * are per-row `put`s, keyed by `contextId:index`, so a backfill merges into
 * what is already stored rather than replacing it.
 *
 * # Why it is bounded
 *
 * This kept every message it ever saw, per context, for good — no eviction, no
 * cap. That was never a decision; it was the absence of one, and it is a
 * liability with no matching benefit: the store exists to make the first paint
 * instant and to answer when the node cannot be reached, and neither needs the
 * whole history. What it needs is the recent tail.
 *
 * `RETAINED_PER_CONTEXT` is that tail. Older rows are dropped after a write,
 * oldest first. Scrolling past the bound still works — reads go to the node,
 * which is the truth; the store is an accelerator, not the answer.
 */

/**
 * How many of the newest messages to keep per context.
 *
 * Enough to open a conversation, scroll back a screen or two, and read offline;
 * not so many that a year of conversation sits encrypted on disk to serve a
 * paint that only ever needs the last screenful.
 */
export const RETAINED_PER_CONTEXT = 200;
export class IndexedDbMessageStore<M extends { index: number }>
  implements MessageStore<M>
{
  async read(contextId: string, start: number, limit: number): Promise<M[]> {
    if (limit <= 0) return [];
    const db = await openDb();
    if (!db) return [];

    const rows = await new Promise<StoredMessage[]>((resolve) => {
      try {
        const range = IDBKeyRange.bound(
          [contextId, start],
          [contextId, start + limit - 1],
        );
        const req = db
          .transaction("messages", "readonly")
          .objectStore("messages")
          .index("byContextIndex")
          .getAll(range);
        req.onsuccess = () => resolve((req.result ?? []) as StoredMessage[]);
        req.onerror = () => resolve([]);
      } catch {
        resolve([]);
      }
    });

    const out: M[] = [];
    for (const row of rows) {
      const message = await unseal<M>(row.sealed);
      // An unreadable row is treated as absent rather than as an empty message.
      // The caller compares what it got against what it asked for and falls
      // through to the node on a short read, so a corrupt row self-heals; a
      // placeholder pushed here would instead be rendered as a real message.
      if (message) out.push(message);
    }
    return out.sort((a, b) => a.index - b.index);
  }

  async put(contextId: string, messages: M[]): Promise<void> {
    if (messages.length === 0) return;
    const db = await openDb();
    if (!db) return;

    // Seal before opening the transaction: an IndexedDB transaction auto-commits
    // as soon as its microtask queue drains, so awaiting WebCrypto inside one
    // ends it early and silently drops the writes that follow.
    const rows: StoredMessage[] = [];
    for (const message of messages) {
      const sealed = await seal(message);
      // No key available means no persistence. Writing plaintext instead would
      // quietly break the promise the policy makes.
      if (!sealed) return;
      rows.push({
        pk: `${contextId}:${message.index}`,
        contextId,
        index: message.index,
        sealed,
      });
    }

    return new Promise((resolve) => {
      try {
        const tx = db.transaction("messages", "readwrite");
        const store = tx.objectStore("messages");
        for (const row of rows) store.put(row);
        tx.oncomplete = () => {
          // Prune outside this transaction: it has already committed the write,
          // and a failure to trim must not lose the rows just stored.
          void this.prune(contextId).then(resolve, () => resolve());
        };
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  /**
   * Drop all but the newest `RETAINED_PER_CONTEXT` rows for one context.
   *
   * Walks the `byContextIndex` range backwards and deletes everything past the
   * bound, so the cost is proportional to what is being removed rather than to
   * what is kept.
   *
   * Best-effort, like every other write here: a store that is full, disabled or
   * throwing in private browsing is not a reason to fail the caller's read or
   * write. The consequence of a failed prune is disk use, not incorrectness.
   */
  async prune(contextId: string): Promise<void> {
    const db = await openDb();
    if (!db) return;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction("messages", "readwrite");
        const store = tx.objectStore("messages");
        const index = store.index("byContextIndex");
        const range = IDBKeyRange.bound(
          [contextId, -Infinity],
          [contextId, Infinity],
        );
        // Newest first, so the first RETAINED_PER_CONTEXT are the keepers.
        const request = index.openCursor(range, "prev");
        let seen = 0;

        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          seen += 1;
          if (seen > RETAINED_PER_CONTEXT) cursor.delete();
          cursor.continue();
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async cursor(contextId: string): Promise<ChannelCursor | undefined> {
    const db = await openDb();
    if (!db) return undefined;
    return new Promise((resolve) => {
      try {
        const req = db
          .transaction("cursors", "readonly")
          .objectStore("cursors")
          .get(contextId);
        req.onsuccess = () => resolve((req.result as ChannelCursor) ?? undefined);
        req.onerror = () => resolve(undefined);
      } catch {
        resolve(undefined);
      }
    });
  }

  async saveCursor(cursor: ChannelCursor): Promise<void> {
    const db = await openDb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction("cursors", "readwrite");
        // Positions only, in the clear: they are what a read must consult
        // before it can decrypt anything, and they say nothing about content.
        tx.objectStore("cursors").put(cursor);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

interface StoredMessage {
  /** `contextId:index` — makes a re-fetch of the same message idempotent. */
  pk: string;
  contextId: string;
  index: number;
  sealed: Sealed;
}
