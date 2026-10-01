import { describe, it, expect } from 'vitest';
import { peersOnDoc, presenceColour } from '../presence';
import type { DocPresence } from '../presence';

const slice = (docId: string): DocPresence => ({
  docId,
  blockId: 'blk',
  anchor: 'anc',
  head: 'anc',
  name: 'Ada',
  colour: '#3b82f6',
});

describe('peersOnDoc', () => {
  it('keeps only the peers on the same document', () => {
    const peers = new Map([
      ['alice', slice('doc-1')],
      ['bob', slice('doc-2')],
    ]);
    expect([...peersOnDoc(peers, 'doc-1').keys()]).toEqual(['alice']);
  });

  it('drops a peer whose slot has been swept', () => {
    const peers = new Map<string, DocPresence | undefined>([
      ['alice', slice('doc-1')],
      ['bob', undefined],
    ]);
    expect([...peersOnDoc(peers, 'doc-1').keys()]).toEqual(['alice']);
  });

  it('is empty for a document nobody else is on', () => {
    const peers = new Map([['bob', slice('doc-2')]]);
    expect(peersOnDoc(peers, 'doc-1').size).toBe(0);
  });
});

describe('presenceColour', () => {
  it('is stable for one author', () => {
    expect(presenceColour('alice')).toBe(presenceColour('alice'));
  });

  it('is a hex colour from the shared preset list', () => {
    expect(presenceColour('alice')).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('separates two authors that differ in one character', () => {
    expect(presenceColour('alice')).not.toBe(presenceColour('alicf'));
  });

  it('has a colour for the empty author id', () => {
    expect(presenceColour('')).toBe('#3b82f6');
  });
});
