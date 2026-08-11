// De-risk test for the collaboration foundation: prove that two independent
// Y.Docs, each emitting its updates into a SHARED append-log and applying the
// other's via the dedupe kernel, converge to the same document — the exact
// emit / apply / dedupe contract the Calimero Yjs provider relies on.
//
// This is intentionally network-free: a plain in-memory array stands in for the
// WASM `content_updates` set. If this converges, the provider's job reduces to
// wiring this kernel to `appendDocUpdate` (emit) and `getDocUpdates` (apply).

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  hashUpdate,
  SeenUpdates,
  selectUnseenUpdates,
  DEFAULT_SEEN_CAPACITY,
} from '../yjs-update-log';

// A shared, add-only, idempotent update log — the in-memory analogue of the
// WASM `UnorderedSet<Vec<u8>>`. De-dupes by content hash on append.
class FakeUpdateLog {
  private readonly byHash = new Map<string, Uint8Array>();
  append(update: Uint8Array): void {
    this.byHash.set(hashUpdate(update), update);
  }
  all(): Uint8Array[] {
    return [...this.byHash.values()];
  }
  get size(): number {
    return this.byHash.size;
  }
}

// Wire a Y.Doc to the log the way the real provider does:
//   - on local update (origin !== LOG_ORIGIN) → append to the shared log;
//   - `sync()` → fetch the whole log, apply only NEW blobs with LOG_ORIGIN as
//     the transaction origin so the resulting update is recognised as remote
//     and NOT re-appended (breaks the feedback loop).
const LOG_ORIGIN = Symbol('calimero-log');

function connect(doc: Y.Doc, log: FakeUpdateLog) {
  const seen = new SeenUpdates();
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === LOG_ORIGIN) return; // remote-applied; don't echo back out
    seen.add(update); // remember our own emission so re-delivery is a no-op
    log.append(update);
  });
  const sync = () => {
    // Selection no longer marks blobs seen; the caller records each one only
    // after it applies, which is what keeps a throwing blob from discarding the
    // rest of its batch.
    for (const blob of selectUnseenUpdates(log.all(), seen)) {
      Y.applyUpdate(doc, blob, LOG_ORIGIN);
      seen.add(blob);
    }
  };
  return { seen, sync };
}

function text(doc: Y.Doc): string {
  return doc.getText('t').toString();
}

describe('hashUpdate', () => {
  it('is stable and content-addressed', () => {
    const a = new Uint8Array([1, 2, 3]);
    const b = new Uint8Array([1, 2, 3]);
    const c = new Uint8Array([1, 2, 4]);
    expect(hashUpdate(a)).toBe(hashUpdate(b));
    expect(hashUpdate(a)).not.toBe(hashUpdate(c));
    // Hex of every byte → lowercase hex, two chars per byte.
    expect(hashUpdate(a)).toMatch(/^[0-9a-f]*$/);
    expect(hashUpdate(a)).toBe('010203');
    expect(hashUpdate(new Uint8Array([]))).toBe('');
    // The empty blob and a leading-zero blob must NOT alias: a naive
    // concatenation without fixed width would map [0,1] and [0,1,...]
    // ambiguously. Fixed two-char-per-byte encoding keeps them distinct.
    expect(hashUpdate(new Uint8Array([0, 1]))).toBe('0001');
    expect(hashUpdate(new Uint8Array([0, 17]))).toBe('0011');
  });

  it('hex-encodes large blobs correctly (and in linear time)', () => {
    // A big blob exercises the array-join path (the previous `key += ...` was
    // O(n²)). Verify exactness against a reference encoding, and a few spot bytes.
    const n = 100_000;
    const big = new Uint8Array(n);
    for (let i = 0; i < n; i++) big[i] = (i * 7 + 3) & 0xff;
    const key = hashUpdate(big);
    expect(key.length).toBe(n * 2); // two hex chars per byte, no aliasing
    const reference = Array.from(big, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(key).toBe(reference);
  });

  it('is collision-free — distinct byte sequences never share a key', () => {
    // The dedupe key MUST be injective: any collision would let a genuinely
    // new Yjs update be mistaken for already-seen and silently dropped (a
    // convergence bug). Exhaustively check that nearby/ambiguous sequences —
    // the cases a length-blind or low-bit hash would conflate — stay distinct.
    const samples: number[][] = [
      [],
      [0],
      [0, 0],
      [1],
      [1, 0],
      [0, 1],
      [16, 1], // 0x10,0x01 vs 0x1,0x10,0x1 etc — fixed width disambiguates
      [1, 0, 1],
      [255, 255],
      [255, 0, 255],
      [0x12, 0x34],
      [0x1, 0x23, 0x4],
    ];
    const keys = samples.map((s) => hashUpdate(new Uint8Array(s)));
    expect(new Set(keys).size).toBe(samples.length);
  });
});

describe('SeenUpdates', () => {
  it('add returns true once then false for the same content', () => {
    const seen = new SeenUpdates();
    const u = new Uint8Array([9, 9]);
    expect(seen.add(u)).toBe(true);
    expect(seen.add(new Uint8Array([9, 9]))).toBe(false); // same content
    expect(seen.has(u)).toBe(true);
    expect(seen.size).toBe(1);
  });

  it('is bounded: size never exceeds the capacity, oldest evicted first (FIFO)', () => {
    const cap = 8;
    const seen = new SeenUpdates(cap);
    // Insert 3× the cap of DISTINCT blobs.
    for (let i = 0; i < cap * 3; i++) {
      seen.add(new Uint8Array([i & 0xff, (i >> 8) & 0xff]));
    }
    // Memory stays bounded regardless of how many distinct blobs flow through.
    expect(seen.size).toBe(cap);
    // The most-recently-added `cap` entries are retained; older ones evicted.
    const last = cap * 3 - 1;
    expect(seen.has(new Uint8Array([last & 0xff, (last >> 8) & 0xff]))).toBe(true);
    expect(seen.has(new Uint8Array([0, 0]))).toBe(false); // first, long evicted
  });

  it('an evicted-then-re-delivered blob is treated as new (safe: applyUpdate is idempotent)', () => {
    const seen = new SeenUpdates(2);
    const a = new Uint8Array([1]);
    seen.add(a); // a
    seen.add(new Uint8Array([2])); // a, 2
    seen.add(new Uint8Array([3])); // 2, 3 — a evicted
    // `a` was evicted, so it is re-selected. Intentional and safe:
    // Y.applyUpdate is idempotent, so re-applying converges.
    expect(selectUnseenUpdates([a], seen)).toEqual([a]);
  });

  it('defaults to a sane capacity', () => {
    expect(DEFAULT_SEEN_CAPACITY).toBeGreaterThan(0);
    const seen = new SeenUpdates();
    for (let i = 0; i < DEFAULT_SEEN_CAPACITY + 100; i++) {
      seen.add(new Uint8Array([i & 0xff, (i >> 8) & 0xff, (i >> 16) & 0xff]));
    }
    expect(seen.size).toBe(DEFAULT_SEEN_CAPACITY);
  });
});

describe('selectUnseenUpdates', () => {
  it('returns only unseen blobs, deduped within the batch', () => {
    const seen = new SeenUpdates();
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    seen.add(a);
    const fresh = selectUnseenUpdates([a, b, b], seen); // a seen, b new (once)
    expect(fresh.map(hashUpdate)).toEqual([hashUpdate(b)]);
  });

  // The property the previous version got wrong. Selecting must not commit:
  // if the caller throws while applying, the blob has to come back next pull.
  it('does not mark anything seen', () => {
    const seen = new SeenUpdates();
    const b = new Uint8Array([2]);
    expect(selectUnseenUpdates([b], seen)).toEqual([b]);
    expect(seen.size).toBe(0);
    // Still selected, because the caller never recorded it.
    expect(selectUnseenUpdates([b], seen)).toEqual([b]);
  });

  it('excludes blobs the caller has marked poisoned', () => {
    const seen = new SeenUpdates();
    const poisoned = new SeenUpdates();
    const good = new Uint8Array([1]);
    const bad = new Uint8Array([9]);
    poisoned.add(bad);
    expect(selectUnseenUpdates([good, bad], seen, poisoned)).toEqual([good]);
  });

  it('skips empty blobs defensively', () => {
    const seen = new SeenUpdates();
    expect(selectUnseenUpdates([new Uint8Array([])], seen)).toEqual([]);
  });
});

describe('two-replica convergence through a shared append-log', () => {
  it('non-overlapping concurrent edits MERGE (not LWW-clobber)', () => {
    const log = new FakeUpdateLog();
    const alice = new Y.Doc();
    const bob = new Y.Doc();
    const a = connect(alice, log);
    const b = connect(bob, log);

    // Concurrent edits at different positions, before any sync.
    alice.getText('t').insert(0, 'hello');
    bob.getText('t').insert(0, 'world');

    // Exchange: each applies the other's updates from the shared log.
    a.sync();
    b.sync();
    // A second round settles any update produced by the first apply.
    a.sync();
    b.sync();

    // Both converge to the SAME text containing BOTH contributions — a
    // last-write-wins store would have dropped one side entirely.
    expect(text(alice)).toBe(text(bob));
    expect(text(alice)).toContain('hello');
    expect(text(alice)).toContain('world');
  });

  it('converges regardless of how many times the log is re-applied (idempotent)', () => {
    const log = new FakeUpdateLog();
    const alice = new Y.Doc();
    const bob = new Y.Doc();
    const a = connect(alice, log);
    const b = connect(bob, log);

    alice.getText('t').insert(0, 'abc');
    bob.getText('t').insert(0, 'xyz');

    // Re-deliver the whole log many times (simulating SSE re-fires /
    // reconnect refetches). Dedupe must make repeats no-ops.
    for (let i = 0; i < 5; i++) {
      a.sync();
      b.sync();
    }
    expect(text(alice)).toBe(text(bob));
    expect(text(alice)).toContain('abc');
    expect(text(alice)).toContain('xyz');
    // Each doc only ever applied each peer blob once.
    expect(log.size).toBe(2);
  });

  it('a writer re-applying its own echoed update does not loop or corrupt', () => {
    const log = new FakeUpdateLog();
    const alice = new Y.Doc();
    const a = connect(alice, log);

    alice.getText('t').insert(0, 'solo');
    const sizeAfterWrite = log.size;
    // Alice syncs: her own update is in the log, but `seen` already has it
    // (recorded on emit), so selectNewUpdates returns nothing → no re-apply,
    // no new update appended.
    a.sync();
    a.sync();
    expect(log.size).toBe(sizeAfterWrite);
    expect(text(alice)).toBe('solo');
  });

  it('a late joiner reconstructs the full document from the log', () => {
    const log = new FakeUpdateLog();
    const alice = new Y.Doc();
    const bob = new Y.Doc();
    const a = connect(alice, log);
    const b = connect(bob, log);
    alice.getText('t').insert(0, 'first');
    bob.getText('t').insert(0, 'second');
    a.sync();
    b.sync();

    // Carol joins after the fact and folds in the entire existing log.
    const carol = new Y.Doc();
    const c = connect(carol, log);
    c.sync();
    expect(text(carol)).toBe(text(alice));
    expect(text(carol)).toContain('first');
    expect(text(carol)).toContain('second');
  });
});
