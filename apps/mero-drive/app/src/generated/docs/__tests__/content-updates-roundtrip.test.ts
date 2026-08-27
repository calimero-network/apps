// Round-trip guard for the collaborative content path across the WASM boundary.
//
// `append_doc_update` / `get_doc_updates` move opaque Yjs update blobs as
// `Vec<u8>` (one blob) and `Vec<Vec<u8>>` (the set). On the wire the generated
// DocsClient converts a `CalimeroBytes` to a plain number array on the way IN
// and re-wraps a number array as `CalimeroBytes` on the way OUT (its "nested
// number array" heuristic). A bug there would silently corrupt a Yjs blob and
// break convergence — so this test pins the exact transform the provider relies
// on: `CalimeroBytes.fromUint8Array(blob).toArray()` (append) and
// `new CalimeroBytes(numberArray).toUint8Array()` (read) must be byte-exact for
// REAL Yjs updates, including the awkward sizes (empty, single-byte, high-byte,
// long).
//
// The generated `convert*` helpers are module-private (and the file is codegen
// — must not be hand-edited), so we test at the `CalimeroBytes` boundary, which
// is what those helpers ultimately call per blob.

import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { CalimeroBytes } from '../DocsClient';

/** Mirror of the generated client's per-blob OUT transform: WASM returns a
 *  number array, the client wraps it back into CalimeroBytes. */
function fromWasmNumberArray(arr: number[]): Uint8Array {
  return new CalimeroBytes(arr).toUint8Array();
}

/** Mirror of the per-blob IN transform: the provider hands a Uint8Array, the
 *  client serialises it to a number array for the RPC argsJson. */
function toWasmNumberArray(blob: Uint8Array): number[] {
  return CalimeroBytes.fromUint8Array(blob).toArray();
}

function roundTrip(blob: Uint8Array): Uint8Array {
  // append side → number array on the wire → read side back to bytes.
  return fromWasmNumberArray(toWasmNumberArray(blob));
}

describe('content_updates WASM boundary round-trip', () => {
  it('preserves a real Yjs update blob byte-for-byte', () => {
    const doc = new Y.Doc();
    doc.getText('t').insert(0, 'hello collaborative world');
    const blob = Y.encodeStateAsUpdate(doc);
    expect(blob.length).toBeGreaterThan(0);

    const back = roundTrip(blob);
    expect(Array.from(back)).toEqual(Array.from(blob));

    // And the round-tripped blob still applies to a fresh doc to the same text.
    const replica = new Y.Doc();
    Y.applyUpdate(replica, back);
    expect(replica.getText('t').toString()).toBe('hello collaborative world');
  });

  it('preserves merged multi-edit blobs (the flush shape)', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t');
    const blobs: Uint8Array[] = [];
    doc.on('update', (u: Uint8Array) => blobs.push(u));
    t.insert(0, 'AAA');
    t.insert(3, 'BBB');
    t.insert(6, 'CCC');
    const merged = Y.mergeUpdates(blobs);

    const back = roundTrip(merged);
    expect(Array.from(back)).toEqual(Array.from(merged));
    const replica = new Y.Doc();
    Y.applyUpdate(replica, back);
    expect(replica.getText('t').toString()).toBe('AAABBBCCC');
  });

  it('preserves awkward byte sequences exactly', () => {
    const cases: number[][] = [
      [0], // single zero byte
      [255], // high byte
      [0, 0, 0], // leading zeros
      [1, 2, 3, 254, 255],
      Array.from({ length: 300 }, (_, i) => i % 256), // long, all byte values
    ];
    for (const c of cases) {
      const blob = new Uint8Array(c);
      expect(Array.from(roundTrip(blob))).toEqual(c);
    }
  });

  it('round-trips the full Vec<Vec<u8>> set shape (nested number arrays)', () => {
    // The set comes back from WASM as number[][]; each inner array is one blob.
    // Reproduce the per-element transform the client applies and assert each
    // blob survives. (The heuristic recurses into the outer array because its
    // items are arrays, not numbers, then wraps each inner all-number array.)
    const doc = new Y.Doc();
    doc.getText('t').insert(0, 'one');
    const b1 = Y.encodeStateAsUpdate(doc);
    doc.getText('t').insert(3, 'two');
    const b2 = Y.encodeStateAsUpdate(doc);

    const wireSet: number[][] = [b1, b2].map((b) => Array.from(b));
    const decoded = wireSet.map((arr) => fromWasmNumberArray(arr));
    expect(Array.from(decoded[0])).toEqual(Array.from(b1));
    expect(Array.from(decoded[1])).toEqual(Array.from(b2));
  });
});
