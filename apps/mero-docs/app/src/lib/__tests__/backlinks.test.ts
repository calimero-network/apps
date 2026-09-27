import { describe, expect, it } from 'vitest';
import { backlinksTo, linksFrom } from '../backlinks';
import {
  rowKey,
  type DocHrefTarget,
  type DocText,
} from '../workspaceIndex/types';

const TARGET = { ws: 'w1', folder: 'f1', doc: 'target' };

function link(
  target: DocHrefTarget,
  sentence: string,
  linkRange: [number, number],
  section?: string,
): DocText['links'][number] {
  return {
    target,
    blockId: 'b',
    sentence,
    linkRange,
    ...(section ? { section } : {}),
  };
}

function doc(
  folderId: string,
  docId: string,
  links: DocText['links'],
): DocText {
  return { folderId, docId, blocks: [], links };
}

function index(...texts: DocText[]): Map<string, DocText> {
  return new Map(texts.map((t) => [rowKey(t.folderId, t.docId), t]));
}

describe('backlinksTo (L-23, L-24)', () => {
  it('lists each linking doc once, with the sentence of its first link', () => {
    const texts = index(
      doc('f2', 'a', [
        link(TARGET, 'See Target now.', [4, 10]),
        link(TARGET, 'Again Target.', [6, 12]),
      ]),
      doc('f2', 'b', [
        link({ ...TARGET, block: 'b9' }, 'Section link', [0, 7]),
      ]),
      doc('f2', 'c', [link({ ...TARGET, doc: 'other' }, 'Elsewhere', [0, 9])]),
    );
    expect(backlinksTo(TARGET, texts)).toEqual([
      { row: 'f2/a', sentence: 'See Target now.', sentenceBold: [[4, 10]] },
      { row: 'f2/b', sentence: 'Section link', sentenceBold: [[0, 7]] },
    ]);
  });

  it('leaves out the target itself and links into another workspace', () => {
    const texts = index(
      doc('f1', 'target', [link(TARGET, 'Self', [0, 4])]),
      doc('f2', 'x', [link({ ...TARGET, ws: 'w2' }, 'Other ws', [0, 5])]),
    );
    expect(backlinksTo(TARGET, texts)).toEqual([]);
  });

  it('bolds nothing when the link text fell outside the sentence', () => {
    const texts = index(doc('f2', 'a', [link(TARGET, '…cut…', [0, 0])]));
    expect(backlinksTo(TARGET, texts)[0].sentenceBold).toEqual([]);
  });

  it('only sees docs in the index, so unreadable docs never appear (L-25)', () => {
    expect(backlinksTo(TARGET, new Map())).toEqual([]);
  });
});

describe('linksFrom', () => {
  it('lists each linked doc once, in document order, with its section', () => {
    const one = { ws: 'w1', folder: 'f2', doc: 'one' };
    const two = { ws: 'w2', folder: 'f3', doc: 'two' };
    const text = doc('f1', 'me', [
      link({ ...one, block: 'b1' }, 'x', [0, 1], 'Plan'),
      link(two, 'y', [0, 1]),
      link(one, 'z', [0, 1], 'Later'),
      link({ ws: 'w1', folder: 'f1', doc: 'me', block: 'b2' }, 'self', [0, 4]),
    ]);
    expect(linksFrom(text)).toEqual([
      { target: { ...one, block: 'b1' }, section: 'Plan' },
      { target: two },
    ]);
  });
});
